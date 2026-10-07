'use strict';

/**
 * Services for looking patrols up: filtering (AF1), completed history
 * (AF2), patrol details (main flow 9-10, AF3) and the reference data the
 * screens need (zones, routes, rangers).
 */

const { GpsStatus, PatrolStatus, IN_PROGRESS_STATUSES } = require('../constants/patrolEnums');
const { NotFoundError, ValidationError } = require('../errors/patrolErrors');
const { roundTo } = require('../utils/geo');
const { withRangerViews } = require('./patrolMonitoring.service');

const DISTANCE_DECIMALS = 2;

const isBlank = (value) => value === undefined || value === null || value === '';

/** @returns {number} the mean of the values, 0 for an empty list */
function average(values, decimals = 1) {
  if (values.length === 0) return 0;
  return roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, decimals);
}

/**
 * SOLID-S: turns raw query-string parameters into validated filter
 * criteria. It neither queries the database nor knows about HTTP.
 */
class PatrolFilterBuilder {
  /**
   * @param {{ rangerId?: string, routeId?: string, status?: string, from?: string, to?: string }} query
   * @returns {{ rangerId?: string, routeId?: string, status?: string, from?: Date, to?: Date }}
   * @throws {ValidationError} when a filter value is not acceptable
   */
  build(query = {}) {
    const errors = {};
    const criteria = {
      ...this.#textCriteria(query),
      ...this.#statusCriteria(query.status, errors),
      ...this.#dateCriteria('from', query.from, errors),
      ...this.#dateCriteria('to', query.to, errors),
    };

    if (criteria.from && criteria.to && criteria.from > criteria.to) {
      errors.to = 'End date must be on or after the start date';
    }
    if (Object.keys(errors).length > 0) {
      throw new ValidationError('Invalid filter values', errors);
    }

    return criteria;
  }

  #textCriteria({ rangerId, routeId }) {
    const criteria = {};
    if (!isBlank(rangerId)) criteria.rangerId = String(rangerId);
    if (!isBlank(routeId)) criteria.routeId = String(routeId);
    return criteria;
  }

  #statusCriteria(status, errors) {
    if (isBlank(status)) return {};
    if (!Object.values(PatrolStatus).includes(status)) {
      errors.status = `Status must be one of: ${Object.values(PatrolStatus).join(', ')}`;
      return {};
    }
    return { status };
  }

  #dateCriteria(field, value, errors) {
    if (isBlank(value)) return {};
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      errors[field] = 'Date is not valid';
      return {};
    }
    return { [field]: date };
  }
}

/**
 * SOLID-S: answers questions about stored patrols for the Filter, History
 * and Details screens.
 * SOLID-I: uses only the PatrolReader contract - it cannot write.
 * SOLID-D: collaborators are injected; nothing is created with `new` here.
 */
class PatrolQueryService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').PatrolReader} deps.patrolReader
   * @param {object} deps.contextLoader PatrolContextLoader
   * @param {object} deps.viewAssembler PatrolViewAssembler
   * @param {PatrolFilterBuilder} deps.filterBuilder
   * @param {object} deps.locationService RangerLocationService
   * @param {() => Date} deps.clock
   */
  constructor({
    patrolReader,
    contextLoader,
    viewAssembler,
    filterBuilder,
    locationService,
    clock,
  }) {
    this.patrolReader = patrolReader;
    this.contextLoader = contextLoader;
    this.viewAssembler = viewAssembler;
    this.filterBuilder = filterBuilder;
    this.locationService = locationService;
    this.clock = clock;
  }

  /**
   * AF1 Filter Patrols.
   * @param {object} query raw query-string parameters
   * @returns {Promise<{ count: number, patrols: object[] }>}
   */
  async listPatrols(query) {
    const criteria = this.filterBuilder.build(query);
    const patrols = await this.#toViews(await this.patrolReader.findByCriteria(criteria));
    return { count: patrols.length, patrols };
  }

  /**
   * AF2 View Completed Patrol History (newest first, with statistics).
   * @returns {Promise<{ statistics: object, patrols: object[] }>}
   */
  async getCompletedHistory() {
    const patrols = await this.#toViews(await this.patrolReader.findCompleted());
    const ratings = patrols.filter((patrol) => patrol.evaluation).map((p) => p.evaluation.rating);

    return {
      statistics: {
        totalCompleted: patrols.length,
        averageCoverage: average(patrols.map((patrol) => patrol.coveragePercentage)),
        averageDurationMinutes: average(
          patrols.map((patrol) => patrol.durationMinutes),
          0,
        ),
        totalDistanceKm: roundTo(
          patrols.reduce((sum, patrol) => sum + patrol.distanceCoveredKm, 0),
          DISTANCE_DECIMALS,
        ),
        evaluatedCount: ratings.length,
        averageRating: average(ratings),
      },
      patrols,
    };
  }

  /**
   * Main flow step 10 / AF3: everything about one patrol. For a patrol in
   * the field the rangers' live locations are requested as well.
   * @param {string} patrolId
   * @returns {Promise<object>}
   * @throws {NotFoundError} when the patrol does not exist
   */
  async getPatrolDetails(patrolId) {
    const patrol = await this.#requirePatrol(patrolId);
    const now = this.clock();
    const context = await this.contextLoader.load([patrol]);
    if (!IN_PROGRESS_STATUSES.includes(patrol.status)) {
      const details = this.viewAssembler.toDetailView(patrol, context, now);
      return { ...details, gpsStatus: GpsStatus.AVAILABLE };
    }

    const tracking = await this.locationService.resolveLocations(context.rangers);
    const liveContext = withRangerViews(context, tracking.rangers);
    const details = this.viewAssembler.toDetailView(patrol, liveContext, now);
    return { ...details, gpsStatus: tracking.gpsStatus };
  }

  /**
   * @param {string} patrolId
   * @returns {Promise<object>} coverage of the patrol by zone
   * @throws {NotFoundError} when the patrol does not exist
   */
  async getPatrolCoverage(patrolId) {
    const patrol = await this.#requirePatrol(patrolId);
    const context = await this.contextLoader.load([patrol]);
    return this.viewAssembler.toCoverageView(patrol, context, this.clock());
  }

  async #requirePatrol(patrolId) {
    const patrol = await this.patrolReader.findByPatrolId(patrolId);
    if (!patrol) throw new NotFoundError(`Patrol ${patrolId} was not found`);
    return patrol;
  }

  async #toViews(patrols) {
    const context = await this.contextLoader.load(patrols);
    const now = this.clock();
    return patrols.map((patrol) => this.viewAssembler.toView(patrol, context, now));
  }
}

/** SOLID-S: serves the map and dropdown data (zones, routes, rangers). */
class PatrolReferenceService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').ParkReader} deps.parkReader
   * @param {import('../repositories/patrolContracts').ZoneReader} deps.zoneReader
   * @param {import('../repositories/patrolContracts').RouteReader} deps.routeReader
   * @param {import('../repositories/patrolContracts').RangerReader} deps.rangerReader
   */
  constructor({ parkReader, zoneReader, routeReader, rangerReader }) {
    this.parkReader = parkReader;
    this.zoneReader = zoneReader;
    this.routeReader = routeReader;
    this.rangerReader = rangerReader;
  }

  /**
   * @param {string} parkId
   * @returns {Promise<{ park: object, zones: object[], routes: object[] }>}
   * @throws {NotFoundError} when the park does not exist
   */
  async getParkMap(parkId) {
    const park = await this.parkReader.findByParkId(parkId);
    if (!park) throw new NotFoundError(`Park ${parkId} was not found`);

    const [zones, routes] = await Promise.all([
      this.zoneReader.findByParkId(parkId),
      this.routeReader.findByParkId(parkId),
    ]);
    return { park, zones, routes };
  }

  /** @returns {Promise<Array<{ rangerId: string, name: string, rank: string }>>} */
  async listRangers() {
    const rangers = await this.rangerReader.findAll();
    return rangers.map(({ rangerId, name, rank, trackingStatus }) => ({
      rangerId,
      name,
      rank,
      trackingStatus,
    }));
  }
}

module.exports = { PatrolFilterBuilder, PatrolQueryService, PatrolReferenceService };
