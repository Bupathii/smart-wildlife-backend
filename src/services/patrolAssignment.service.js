'use strict';

/**
 * Services for assigning patrols and carrying them out:
 *  - PatrolPlanningService: the Park Manager creates, edits and cancels
 *    planned patrols (route + rangers + time).
 *  - RangerPatrolService: a ranger, signed in on the mobile app, views the
 *    assigned patrol, starts it, sends phone locations and completes it.
 */

const {
  LocationSource,
  PatrolStatus,
  TrackingStatus,
  IN_PROGRESS_STATUSES,
} = require('../constants/patrolEnums');
const { ConflictError, NotFoundError, ValidationError } = require('../errors/patrolErrors');
const { LocationPoint } = require('../models/patrolDomain');
const { roundTo } = require('../utils/geo');

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const PATROL_ID_PREFIX = 'PT-';
const PATROL_ID_DIGITS = 3;
const RECENT_HISTORY_SIZE = 5;
const DISTANCE_DECIMALS = 2;

/** A patrol that is planned or in the field keeps its rangers busy. */
const OPEN_STATUSES = Object.freeze([PatrolStatus.PLANNED, ...IN_PROGRESS_STATUSES]);

const toTime = (value) => new Date(value).getTime();
const isOpen = (patrol) => OPEN_STATUSES.includes(patrol.status);
const isInProgress = (patrol) => IN_PROGRESS_STATUSES.includes(patrol.status);
const withoutEmpty = (problems) =>
  Object.fromEntries(Object.entries(problems).filter(([, message]) => message));

/** @returns {Date|null} the parsed date, or null when it is not a real date */
function toDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** @returns {number} the mean of the values, 0 for an empty list */
function average(values) {
  if (values.length === 0) return 0;
  return roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 1);
}

/** The route's waypoints in order, each marked as reached or not. */
function toWaypointChecklist(details) {
  const reached = details.timeline
    .filter((event) => event.type === 'WAYPOINT')
    .map((event) => event.waypointIndex);

  return details.route.waypoints.map((waypoint, index) => ({
    number: index + 1,
    latitude: waypoint.latitude,
    longitude: waypoint.longitude,
    reached: reached.includes(index),
  }));
}

/**
 * SOLID-S: checks a patrol plan and nothing else. The facts it needs (does
 * the route exist, which rangers are busy) are looked up by the service
 * and passed in, so this class never touches the database.
 */
class PatrolPlanValidator {
  /** @param {{ MAX_RANGERS: number, MAX_DURATION_HOURS: number }} limits */
  constructor(limits) {
    this.limits = limits;
  }

  /**
   * @param {{ routeId: *, rangerIds: *, startTime: *, endTime: * }} input raw request data
   * @param {{ route: object|null, knownRangerIds: string[], busyRangers: Array<{name:string, patrolId:string}> }} facts
   * @returns {{ routeId: string, rangerIds: string[], startTime: Date, endTime: Date }}
   * @throws {ValidationError} with one message per invalid field
   */
  assertValid(input, facts) {
    const startTime = toDate(input.startTime);
    const endTime = toDate(input.endTime);
    const fieldErrors = withoutEmpty({
      routeId: facts.route ? null : 'Choose a patrol route',
      rangerIds: this.#rangersProblem(input.rangerIds, facts),
      startTime: startTime ? null : 'Start time is not valid',
      endTime: this.#endTimeProblem(startTime, endTime),
    });
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError('Patrol plan is not valid', fieldErrors);
    }

    return {
      routeId: facts.route.routeId,
      rangerIds: [...new Set(input.rangerIds)],
      startTime,
      endTime,
    };
  }

  #rangersProblem(rangerIds, { knownRangerIds, busyRangers }) {
    if (!Array.isArray(rangerIds) || rangerIds.length === 0) return 'Assign at least one ranger';
    if (rangerIds.length > this.limits.MAX_RANGERS) {
      return `A patrol can have at most ${this.limits.MAX_RANGERS} rangers`;
    }

    const unknown = rangerIds.find((rangerId) => !knownRangerIds.includes(rangerId));
    if (unknown !== undefined) return `Ranger ${unknown} was not found`;

    const [busy] = busyRangers;
    return busy ? `${busy.name} is already assigned to patrol ${busy.patrolId}` : null;
  }

  #endTimeProblem(startTime, endTime) {
    if (!endTime) return 'End time is not valid';
    if (!startTime) return null;
    if (endTime <= startTime) return 'End time must be after the start time';

    const hours = (endTime.getTime() - startTime.getTime()) / MILLISECONDS_PER_HOUR;
    return hours > this.limits.MAX_DURATION_HOURS
      ? `A patrol can last at most ${this.limits.MAX_DURATION_HOURS} hours`
      : null;
  }
}

/**
 * SOLID-S: the Park Manager's planning flows (create, edit, cancel).
 * SOLID-I: uses PatrolReader + PatrolWriter, RouteReader and RangerReader.
 * SOLID-D: all of them, the validator and the clock are injected.
 */
class PatrolPlanningService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').PatrolReader} deps.patrolReader
   * @param {import('../repositories/patrolContracts').PatrolWriter} deps.patrolWriter
   * @param {import('../repositories/patrolContracts').RouteReader} deps.routeReader
   * @param {import('../repositories/patrolContracts').RangerReader} deps.rangerReader
   * @param {PatrolPlanValidator} deps.validator
   */
  constructor({ patrolReader, patrolWriter, routeReader, rangerReader, validator }) {
    this.patrolReader = patrolReader;
    this.patrolWriter = patrolWriter;
    this.routeReader = routeReader;
    this.rangerReader = rangerReader;
    this.validator = validator;
  }

  /**
   * @param {{ routeId: string, rangerIds: string[], startTime: string, endTime: string }} input
   * @returns {Promise<object>} the new PLANNED patrol
   * @throws {ValidationError}
   */
  async createPatrol(input = {}) {
    const plan = await this.#validate(input, null);
    const route = await this.routeReader.findByRouteId(plan.routeId);
    const patrol = {
      patrolId: await this.#nextPatrolId(),
      parkId: route.parkId,
      ...plan,
      status: PatrolStatus.PLANNED,
      progressPercentage: 0,
      coveragePercentage: 0,
      track: [],
      coverage: null,
      evaluation: null,
    };

    await this.patrolWriter.createPatrol(patrol);
    return patrol;
  }

  /**
   * @param {string} patrolId
   * @param {object} input same fields as createPatrol
   * @returns {Promise<object>} the updated patrol
   * @throws {NotFoundError|ConflictError|ValidationError}
   */
  async updatePatrol(patrolId, input = {}) {
    await this.#requirePlanned(patrolId, 'changed');
    const plan = await this.#validate(input, patrolId);
    return this.patrolWriter.updatePatrol(patrolId, plan);
  }

  /**
   * @param {string} patrolId
   * @returns {Promise<object>} the cancelled patrol
   * @throws {NotFoundError|ConflictError}
   */
  async cancelPatrol(patrolId) {
    await this.#requirePlanned(patrolId, 'cancelled');
    return this.patrolWriter.updatePatrol(patrolId, { status: PatrolStatus.CANCELLED });
  }

  /** Only a patrol that has not started may be changed or cancelled. */
  async #requirePlanned(patrolId, action) {
    const patrol = await this.patrolReader.findByPatrolId(patrolId);
    if (!patrol) throw new NotFoundError(`Patrol ${patrolId} was not found`);
    if (patrol.status !== PatrolStatus.PLANNED) {
      throw new ConflictError(
        `Only a planned patrol can be ${action}. This one has already started.`,
      );
    }
    return patrol;
  }

  async #validate(input, ownPatrolId) {
    const rangerIds = Array.isArray(input.rangerIds) ? input.rangerIds : [];
    const [route, rangers] = await Promise.all([
      input.routeId ? this.routeReader.findByRouteId(String(input.routeId)) : null,
      this.rangerReader.findByRangerIds(rangerIds),
    ]);
    const busyRangers = await this.#busyRangers(rangers, ownPatrolId);

    return this.validator.assertValid(input, {
      route,
      knownRangerIds: rangers.map((ranger) => ranger.rangerId),
      busyRangers,
    });
  }

  /** Rangers who already have another planned or in-progress patrol. */
  async #busyRangers(rangers, ownPatrolId) {
    const busy = [];
    for (const ranger of rangers) {
      const patrols = await this.patrolReader.findByCriteria({ rangerId: ranger.rangerId });
      const other = patrols.find((patrol) => isOpen(patrol) && patrol.patrolId !== ownPatrolId);
      if (other) busy.push({ name: ranger.name, patrolId: other.patrolId });
    }
    return busy;
  }

  /** The next free id in the PT-001, PT-002, … sequence. */
  async #nextPatrolId() {
    const patrolIds = await this.patrolReader.findPatrolIds();
    const highest = patrolIds.reduce((max, patrolId) => {
      const number = Number.parseInt(patrolId.replace(PATROL_ID_PREFIX, ''), 10);
      return Number.isNaN(number) ? max : Math.max(max, number);
    }, 0);

    return `${PATROL_ID_PREFIX}${String(highest + 1).padStart(PATROL_ID_DIGITS, '0')}`;
  }
}

/**
 * SOLID-S: turns the raw positions a phone sends into track points, and
 * rejects anything that is not a believable position.
 */
class DeviceLocationValidator {
  /** @param {{ MAX_POINTS_PER_REQUEST: number, LIVE_WITHIN_SECONDS: number, FUTURE_TOLERANCE_SECONDS: number }} limits */
  constructor(limits) {
    this.limits = limits;
  }

  /**
   * @param {*} points raw `[{ latitude, longitude, timestamp }]`
   * @param {Date} now
   * @returns {object[]} track points, oldest first; points recorded a while
   *          ago (sent after being offline) are marked SYNCHRONIZED
   * @throws {ValidationError}
   */
  assertValid(points, now) {
    const problem = this.#problem(points, now);
    if (problem) throw new ValidationError('Locations are not valid', { points: problem });

    return points
      .map((point) => this.#toTrackPoint(point, now))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  #problem(points, now) {
    if (!Array.isArray(points) || points.length === 0) return 'Send at least one location';
    if (points.length > this.limits.MAX_POINTS_PER_REQUEST) {
      return `Send at most ${this.limits.MAX_POINTS_PER_REQUEST} locations at a time`;
    }

    const latest = now.getTime() + this.limits.FUTURE_TOLERANCE_SECONDS * MILLISECONDS_PER_SECOND;
    const invalid = points.findIndex((point) => {
      const timestamp = toDate(point?.timestamp);
      const position = LocationPoint.from(point ?? {});
      return !position.isValid() || !timestamp || timestamp.getTime() > latest;
    });
    return invalid >= 0 ? `Location ${invalid + 1} is not a valid position and time` : null;
  }

  #toTrackPoint(point, now) {
    const timestamp = new Date(point.timestamp);
    const ageSeconds = (now.getTime() - timestamp.getTime()) / MILLISECONDS_PER_SECOND;
    const live = ageSeconds <= this.limits.LIVE_WITHIN_SECONDS;

    return {
      latitude: point.latitude,
      longitude: point.longitude,
      timestamp,
      source: live ? LocationSource.GPS : LocationSource.SYNCHRONIZED,
    };
  }
}

/**
 * SOLID-S: what a ranger does with their own patrol from the mobile app.
 * SOLID-D: repositories, the view assembler, validator and clock are
 * injected; the ranger is identified by the account e-mail the host
 * application supplies.
 */
class RangerPatrolService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').PatrolReader} deps.patrolReader
   * @param {import('../repositories/patrolContracts').PatrolWriter} deps.patrolWriter
   * @param {import('../repositories/patrolContracts').TrackWriter} deps.trackWriter
   * @param {object} deps.rangerRepository RangerReader + RangerTrackingWriter
   * @param {object} deps.contextLoader PatrolContextLoader
   * @param {object} deps.viewAssembler PatrolViewAssembler
   * @param {DeviceLocationValidator} deps.locationValidator
   * @param {() => Date} deps.clock
   */
  constructor(deps) {
    this.patrolReader = deps.patrolReader;
    this.patrolWriter = deps.patrolWriter;
    this.trackWriter = deps.trackWriter;
    this.rangerRepository = deps.rangerRepository;
    this.contextLoader = deps.contextLoader;
    this.viewAssembler = deps.viewAssembler;
    this.locationValidator = deps.locationValidator;
    this.clock = deps.clock;
  }

  /**
   * @param {string} userEmail the signed-in ranger's account e-mail
   * @returns {Promise<{ ranger: object, patrol: object|null, insights: object, history: object[] }>}
   * @throws {NotFoundError} when no ranger profile is linked to the account
   */
  async getMyPatrol(userEmail) {
    const ranger = await this.#requireRanger(userEmail);
    const patrols = await this.patrolReader.findByCriteria({ rangerId: ranger.rangerId });
    const context = await this.contextLoader.load(patrols);
    const now = this.clock();
    const current = this.#currentOf(patrols);
    const completed = patrols
      .filter((patrol) => patrol.status === PatrolStatus.COMPLETED)
      .sort((a, b) => toTime(b.endTime) - toTime(a.endTime))
      .map((patrol) => this.viewAssembler.toView(patrol, context, now));

    return {
      ranger: { rangerId: ranger.rangerId, name: ranger.name, rank: ranger.rank },
      patrol: current ? this.#currentView(current, context, now) : null,
      insights: this.#insights(completed),
      history: completed.slice(0, RECENT_HISTORY_SIZE),
    };
  }

  /**
   * PLANNED → ACTIVE. The actual start time replaces the planned one.
   * @param {string} userEmail
   * @returns {Promise<object>} same shape as getMyPatrol
   * @throws {NotFoundError|ConflictError}
   */
  async startPatrol(userEmail) {
    const current = await this.#requireCurrent(userEmail);
    if (current.status !== PatrolStatus.PLANNED) {
      throw new ConflictError(`Patrol ${current.patrolId} has already been started`);
    }

    await this.patrolWriter.updatePatrol(current.patrolId, {
      status: PatrolStatus.ACTIVE,
      startTime: this.clock(),
    });
    return this.getMyPatrol(userEmail);
  }

  /**
   * Stores positions reported by the ranger's phone on the patrol track
   * and as the ranger's last known location.
   * @param {string} userEmail
   * @param {object[]} points `[{ latitude, longitude, timestamp }]`
   * @returns {Promise<{ accepted: number, patrolId: string, progressPercentage: number, distanceCoveredKm: number }>}
   * @throws {NotFoundError|ConflictError|ValidationError}
   */
  async recordLocations(userEmail, points) {
    const ranger = await this.#requireRanger(userEmail);
    const current = await this.#requireCurrent(userEmail);
    if (!isInProgress(current)) {
      throw new ConflictError('Start the patrol before sending locations');
    }

    const trackPoints = this.locationValidator.assertValid(points, this.clock());
    const latest = trackPoints.at(-1);
    await this.trackWriter.appendTrackPoints(current.patrolId, trackPoints);
    await this.rangerRepository.updateTracking(ranger.rangerId, {
      trackingStatus: TrackingStatus.ONLINE,
      lastSyncTime: latest.timestamp,
      lastKnownLocation: latest,
    });

    const { patrol } = await this.getMyPatrol(userEmail);
    return {
      accepted: trackPoints.length,
      patrolId: current.patrolId,
      progressPercentage: patrol.progressPercentage,
      distanceCoveredKm: patrol.distanceCoveredKm,
    };
  }

  /**
   * In progress → COMPLETED, with the final progress and coverage stored.
   * @param {string} userEmail
   * @returns {Promise<object>} same shape as getMyPatrol
   * @throws {NotFoundError|ConflictError}
   */
  async completePatrol(userEmail) {
    const current = await this.#requireCurrent(userEmail);
    if (!isInProgress(current)) {
      throw new ConflictError('Only a patrol that has been started can be completed');
    }

    const now = this.clock();
    const context = await this.contextLoader.load([current]);
    const finished = { ...current, status: PatrolStatus.COMPLETED, endTime: now };
    const view = this.viewAssembler.toView(finished, context, now);
    await this.patrolWriter.updatePatrol(current.patrolId, {
      status: PatrolStatus.COMPLETED,
      endTime: now,
      progressPercentage: view.progressPercentage,
      coveragePercentage: view.coveragePercentage,
    });
    return this.getMyPatrol(userEmail);
  }

  async #requireRanger(userEmail) {
    const ranger = userEmail ? await this.rangerRepository.findByUserEmail(userEmail) : null;
    if (!ranger) throw new NotFoundError('No ranger profile is linked to this account');
    return ranger;
  }

  async #requireCurrent(userEmail) {
    const ranger = await this.#requireRanger(userEmail);
    const patrols = await this.patrolReader.findByCriteria({ rangerId: ranger.rangerId });
    const current = this.#currentOf(patrols);
    if (!current) throw new NotFoundError('No patrol is assigned to you at the moment');
    return current;
  }

  /** The patrol in the field, otherwise the next planned one. */
  #currentOf(patrols) {
    const planned = patrols
      .filter((patrol) => patrol.status === PatrolStatus.PLANNED)
      .sort((a, b) => toTime(a.startTime) - toTime(b.startTime));
    return patrols.find(isInProgress) ?? planned[0] ?? null;
  }

  #currentView(patrol, context, now) {
    const details = this.viewAssembler.toDetailView(patrol, context, now);
    const waypoints = toWaypointChecklist(details);

    return {
      patrolId: details.patrolId,
      status: details.status,
      startTime: details.startTime,
      endTime: details.endTime,
      durationMinutes: isInProgress(patrol) ? details.durationMinutes : 0,
      route: {
        routeId: details.route.routeId,
        name: details.route.name,
        description: details.route.description,
        routeLength: details.route.routeLength,
      },
      waypoints,
      waypointsReached: waypoints.filter((waypoint) => waypoint.reached).length,
      progressPercentage: details.progressPercentage,
      distanceCoveredKm: details.distanceCoveredKm,
      coveragePercentage: details.coveragePercentage,
      teammates: details.rangers.map((ranger) => ranger.name),
      lastUpdate: details.lastUpdate,
    };
  }

  #insights(completed) {
    const evaluated = completed.filter((patrol) => patrol.evaluation);
    const latest = evaluated[0];

    return {
      completedPatrols: completed.length,
      averageCoverage: average(completed.map((patrol) => patrol.coveragePercentage)),
      totalDistanceKm: roundTo(
        completed.reduce((sum, patrol) => sum + patrol.distanceCoveredKm, 0),
        DISTANCE_DECIMALS,
      ),
      averageRating: average(evaluated.map((patrol) => patrol.evaluation.rating)),
      lastEvaluation: latest
        ? {
            patrolId: latest.patrolId,
            rating: latest.evaluation.rating,
            notes: latest.evaluation.notes,
          }
        : null,
    };
  }
}

module.exports = {
  PatrolPlanValidator,
  PatrolPlanningService,
  DeviceLocationValidator,
  RangerPatrolService,
  OPEN_STATUSES,
};
