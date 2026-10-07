'use strict';

/**
 * Services for managing patrol routes (create, edit, delete). Routes are
 * the planned paths that patrols are measured against, so the rules here
 * protect patrols that are using a route.
 */

const { LocationSource, IN_PROGRESS_STATUSES } = require('../constants/patrolEnums');
const { ConflictError, NotFoundError, ValidationError } = require('../errors/patrolErrors');
const { LocationPoint } = require('../models/patrolDomain');
const { routeLengthKm, roundTo } = require('../utils/geo');

const DISTANCE_DECIMALS = 2;
const ROUTE_ID_PREFIX = 'RT-';
const ROUTE_ID_DIGITS = 3;

const sameText = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** True when both lists hold the same positions in the same order. */
function sameWaypoints(first, second) {
  if (first.length !== second.length) return false;
  return first.every(
    (point, index) =>
      point.latitude === second[index].latitude && point.longitude === second[index].longitude,
  );
}

/**
 * SOLID-S: validation of route input only. It reports every problem at
 * once, by field, and never reads or writes the database.
 */
class RouteValidator {
  /** @param {{ MIN_WAYPOINTS: number, MAX_WAYPOINTS: number, NAME_MAX_LENGTH: number, DESCRIPTION_MAX_LENGTH: number }} limits */
  constructor(limits) {
    this.limits = limits;
  }

  /**
   * @param {{ name: *, description?: *, waypoints: * }} input raw request data
   * @param {{ zones: object[], otherRouteNames: string[] }} context
   * @returns {{ name: string, description: string, waypoints: object[] }} cleaned values
   * @throws {ValidationError} with one message per invalid field
   */
  assertValid(input, { zones, otherRouteNames }) {
    const description = input.description ?? '';
    const problems = {
      name: this.#nameProblem(input.name, otherRouteNames),
      description: this.#descriptionProblem(description),
      waypoints: this.#waypointsProblem(input.waypoints, zones),
    };
    const fieldErrors = Object.fromEntries(
      Object.entries(problems).filter(([, message]) => message),
    );
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError('Route is not valid', fieldErrors);
    }

    return {
      name: input.name.trim(),
      description: description.trim(),
      waypoints: input.waypoints.map(({ latitude, longitude }) => ({
        latitude,
        longitude,
        timestamp: null,
        source: LocationSource.MANUAL,
      })),
    };
  }

  #nameProblem(name, otherRouteNames) {
    if (typeof name !== 'string' || name.trim() === '') return 'Route name is required';
    if (name.trim().length > this.limits.NAME_MAX_LENGTH) {
      return `Route name must be ${this.limits.NAME_MAX_LENGTH} characters or fewer`;
    }
    if (otherRouteNames.some((other) => sameText(other, name))) {
      return 'Another route already has this name';
    }
    return null;
  }

  #descriptionProblem(description) {
    if (typeof description !== 'string') return 'Description must be text';
    if (description.length > this.limits.DESCRIPTION_MAX_LENGTH) {
      return `Description must be ${this.limits.DESCRIPTION_MAX_LENGTH} characters or fewer`;
    }
    return null;
  }

  #waypointsProblem(waypoints, zones) {
    const { MIN_WAYPOINTS, MAX_WAYPOINTS } = this.limits;
    if (!Array.isArray(waypoints) || waypoints.length < MIN_WAYPOINTS) {
      return `A route needs at least ${MIN_WAYPOINTS} waypoints`;
    }
    if (waypoints.length > MAX_WAYPOINTS) {
      return `A route can have at most ${MAX_WAYPOINTS} waypoints`;
    }

    const invalid = waypoints.findIndex((point) => !LocationPoint.from(point ?? {})?.isValid());
    if (invalid >= 0) return `Waypoint ${invalid + 1} does not have valid coordinates`;

    const outside = waypoints.findIndex((point) => !zones.some((zone) => zone.contains(point)));
    return outside >= 0 ? `Waypoint ${outside + 1} is outside the park zones` : null;
  }
}

/**
 * SOLID-S: runs the create / edit / delete flows for patrol routes.
 * SOLID-I: depends on small contracts - RouteReader, RouteWriter,
 * ZoneReader, ParkReader and PatrolReader - never a whole repository.
 * SOLID-D: all of them, and the validator, are injected.
 */
class PatrolRouteService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').RouteReader} deps.routeReader
   * @param {import('../repositories/patrolContracts').RouteWriter} deps.routeWriter
   * @param {import('../repositories/patrolContracts').ZoneReader} deps.zoneReader
   * @param {import('../repositories/patrolContracts').ParkReader} deps.parkReader
   * @param {import('../repositories/patrolContracts').PatrolReader} deps.patrolReader
   * @param {RouteValidator} deps.validator
   */
  constructor({ routeReader, routeWriter, zoneReader, parkReader, patrolReader, validator }) {
    this.routeReader = routeReader;
    this.routeWriter = routeWriter;
    this.zoneReader = zoneReader;
    this.parkReader = parkReader;
    this.patrolReader = patrolReader;
    this.validator = validator;
  }

  /**
   * @param {string} parkId
   * @returns {Promise<object[]>} routes with how they are being used
   * @throws {NotFoundError} when the park does not exist
   */
  async listRoutes(parkId) {
    await this.#requirePark(parkId);
    const routes = await this.routeReader.findByParkId(parkId);
    return Promise.all(routes.map((route) => this.#withUsage(route)));
  }

  /**
   * @param {string} parkId
   * @param {{ name: string, description?: string, waypoints: object[] }} input
   * @returns {Promise<object>} the stored route
   * @throws {NotFoundError|ValidationError}
   */
  async createRoute(parkId, input = {}) {
    await this.#requirePark(parkId);
    const values = await this.#validate(parkId, input, null);
    const route = {
      routeId: await this.#nextRouteId(),
      ...values,
      ...(await this.#derivedFields(parkId, values.waypoints)),
    };

    await this.routeWriter.createRoute(parkId, route);
    return this.#withUsage({ ...route, parkId });
  }

  /**
   * @param {string} parkId
   * @param {string} routeId
   * @param {{ name: string, description?: string, waypoints: object[] }} input
   * @returns {Promise<object>} the updated route
   * @throws {NotFoundError|ValidationError|ConflictError}
   */
  async updateRoute(parkId, routeId, input = {}) {
    const existing = await this.#requireRoute(parkId, routeId);
    const values = await this.#validate(parkId, input, routeId);
    const usage = await this.#usage(routeId);
    if (usage.hasActivePatrol && !sameWaypoints(existing.waypoints, values.waypoints)) {
      throw new ConflictError(
        'Waypoints cannot be changed while a patrol is using this route. You can still edit the name and description.',
      );
    }

    const route = { routeId, ...values, ...(await this.#derivedFields(parkId, values.waypoints)) };
    await this.routeWriter.updateRoute(routeId, route);
    return { ...route, parkId, ...usage };
  }

  /**
   * @param {string} parkId
   * @param {string} routeId
   * @returns {Promise<void>}
   * @throws {NotFoundError|ConflictError}
   */
  async deleteRoute(parkId, routeId) {
    await this.#requireRoute(parkId, routeId);
    const usage = await this.#usage(routeId);
    if (usage.patrolCount > 0) {
      throw new ConflictError(
        `This route is used by ${usage.patrolCount} patrol(s) and cannot be deleted.`,
      );
    }

    await this.routeWriter.deleteRoute(routeId);
  }

  async #requirePark(parkId) {
    const park = await this.parkReader.findByParkId(parkId);
    if (!park) throw new NotFoundError(`Park ${parkId} was not found`);
    return park;
  }

  async #requireRoute(parkId, routeId) {
    await this.#requirePark(parkId);
    const route = await this.routeReader.findByRouteId(routeId);
    if (!route || route.parkId !== parkId) {
      throw new NotFoundError(`Route ${routeId} was not found`);
    }
    return route;
  }

  /** Validates the input against the park's zones and its other routes. */
  async #validate(parkId, input, ownRouteId) {
    const [zones, routes] = await Promise.all([
      this.zoneReader.findByParkId(parkId),
      this.routeReader.findByParkId(parkId),
    ]);
    const otherRouteNames = routes
      .filter((route) => route.routeId !== ownRouteId)
      .map((route) => route.name);

    return this.validator.assertValid(input, { zones, otherRouteNames });
  }

  /** Length and zones are worked out from the waypoints, never typed in. */
  async #derivedFields(parkId, waypoints) {
    const zones = await this.zoneReader.findByParkId(parkId);
    return {
      routeLength: roundTo(routeLengthKm(waypoints), DISTANCE_DECIMALS),
      zoneIds: zones
        .filter((zone) => waypoints.some((point) => zone.contains(point)))
        .map((zone) => zone.zoneId),
    };
  }

  async #usage(routeId) {
    const patrols = await this.patrolReader.findByCriteria({ routeId });
    return {
      patrolCount: patrols.length,
      hasActivePatrol: patrols.some((patrol) => IN_PROGRESS_STATUSES.includes(patrol.status)),
    };
  }

  async #withUsage(route) {
    return { ...route, ...(await this.#usage(route.routeId)) };
  }

  /** The next free id in the RT-001, RT-002, … sequence. */
  async #nextRouteId() {
    const routes = await this.routeReader.findAll();
    const highest = routes.reduce((max, route) => {
      const number = Number.parseInt(route.routeId.replace(ROUTE_ID_PREFIX, ''), 10);
      return Number.isNaN(number) ? max : Math.max(max, number);
    }, 0);

    return `${ROUTE_ID_PREFIX}${String(highest + 1).padStart(ROUTE_ID_DIGITS, '0')}`;
  }
}

module.exports = { RouteValidator, PatrolRouteService };
