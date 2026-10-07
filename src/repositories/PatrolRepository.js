'use strict';

const { PatrolReader } = require('./patrolContracts');
const { PatrolStatus, IN_PROGRESS_STATUSES } = require('../constants/patrolEnums');

const NEWEST_FIRST = -1;
const OLDEST_FIRST = 1;

/** Removes database-only fields so services receive plain patrol data. */
function toPatrol(document) {
  if (!document) return null;
  const patrol = { ...document };
  delete patrol._id;
  delete patrol.__v;
  return { ...patrol, track: patrol.track ?? [] };
}

/** Builds the startTime condition for a from/to date range. */
function startTimeRange({ from, to }) {
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
}

/** Translates neutral filter criteria into a MongoDB filter. */
function toMongoFilter(criteria) {
  const filter = {};
  if (criteria.rangerId) filter.rangerIds = criteria.rangerId;
  if (criteria.routeId) filter.routeId = criteria.routeId;
  if (criteria.status) filter.status = criteria.status;

  const range = startTimeRange(criteria);
  if (range) filter.startTime = range;
  return filter;
}

/**
 * PATTERN-Repository: the only class that knows patrols are stored in
 * MongoDB. Services talk to the contracts in patrolContracts.js.
 *
 * SOLID-S: data access only - no progress, coverage or validation rules.
 *
 * It fulfils four contracts: PatrolReader (inherited), PatrolWriter,
 * EvaluationWriter and TrackWriter (JavaScript allows one parent class, so the writer
 * contracts are met by implementing their methods).
 */
class PatrolRepository extends PatrolReader {
  /** @param {import('mongoose').Model} patrolModel injected Mongoose model */
  constructor(patrolModel) {
    super();
    this.patrolModel = patrolModel;
  }

  /** @param {string} patrolId @returns {Promise<object|null>} */
  async findByPatrolId(patrolId) {
    return toPatrol(await this.patrolModel.findOne({ patrolId }).lean());
  }

  /** @returns {Promise<object[]>} */
  async findInProgress() {
    return this.#find({ status: { $in: IN_PROGRESS_STATUSES } }, { startTime: OLDEST_FIRST });
  }

  /** @returns {Promise<object[]>} */
  async findCompleted() {
    return this.#find({ status: PatrolStatus.COMPLETED }, { endTime: NEWEST_FIRST });
  }

  /** @param {Date} since @returns {Promise<object[]>} */
  async findCompletedSince(since) {
    const filter = { status: PatrolStatus.COMPLETED, endTime: { $gte: since } };
    return this.#find(filter, { endTime: NEWEST_FIRST });
  }

  /**
   * @param {{ rangerId?: string, routeId?: string, status?: string, from?: Date, to?: Date }} criteria
   * @returns {Promise<object[]>}
   */
  async findByCriteria(criteria) {
    return this.#find(toMongoFilter(criteria), { startTime: NEWEST_FIRST });
  }

  /**
   * Stores the evaluation, replacing any earlier one (a patrol has 0..1).
   * @param {string} patrolId
   * @param {object} evaluation
   * @returns {Promise<object|null>} the stored evaluation
   */
  async saveEvaluation(patrolId, evaluation) {
    const updated = await this.patrolModel
      .findOneAndUpdate({ patrolId }, { $set: { evaluation } }, { new: true, runValidators: true })
      .lean();
    return updated ? updated.evaluation : null;
  }

  /**
   * @param {string} patrolId
   * @param {object} point LocationPoint data
   * @returns {Promise<void>}
   */
  async appendTrackPoint(patrolId, point) {
    await this.patrolModel.updateOne({ patrolId }, { $push: { track: point } });
  }

  /**
   * @param {string} patrolId
   * @param {object[]} points LocationPoint data, oldest first
   * @returns {Promise<void>}
   */
  async appendTrackPoints(patrolId, points) {
    await this.patrolModel.updateOne({ patrolId }, { $push: { track: { $each: points } } });
  }

  /** @returns {Promise<string[]>} */
  async findPatrolIds() {
    const documents = await this.patrolModel.find({}, { patrolId: 1 }).lean();
    return documents.map((document) => document.patrolId);
  }

  /** @param {object} patrol complete patrol data @returns {Promise<void>} */
  async createPatrol(patrol) {
    await this.patrolModel.create(patrol);
  }

  /**
   * @param {string} patrolId
   * @param {object} changes fields to replace
   * @returns {Promise<object|null>} the updated patrol
   */
  async updatePatrol(patrolId, changes) {
    const updated = await this.patrolModel
      .findOneAndUpdate({ patrolId }, { $set: changes }, { new: true, runValidators: true })
      .lean();
    return toPatrol(updated);
  }

  async #find(filter, sort) {
    const documents = await this.patrolModel.find(filter).sort(sort).lean();
    return documents.map(toPatrol);
  }
}

module.exports = PatrolRepository;
