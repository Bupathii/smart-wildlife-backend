'use strict';

const { RangerReader } = require('./patrolContracts');

/** Removes database-only fields so services receive plain ranger data. */
function toRanger(document) {
  if (!document) return null;
  const ranger = { ...document };
  delete ranger._id;
  delete ranger.__v;
  return ranger;
}

/**
 * PATTERN-Repository: MongoDB access for rangers. Fulfils RangerReader
 * (inherited) and RangerTrackingWriter (updateTracking).
 */
class RangerRepository extends RangerReader {
  /** @param {import('mongoose').Model} rangerModel injected Mongoose model */
  constructor(rangerModel) {
    super();
    this.rangerModel = rangerModel;
  }

  /** @returns {Promise<object[]>} all rangers, sorted by name */
  async findAll() {
    const documents = await this.rangerModel.find({}).sort({ name: 1 }).lean();
    return documents.map(toRanger);
  }

  /** @param {string} rangerId @returns {Promise<object|null>} */
  async findByRangerId(rangerId) {
    return toRanger(await this.rangerModel.findOne({ rangerId }).lean());
  }

  /** @param {string[]} rangerIds @returns {Promise<object[]>} */
  async findByRangerIds(rangerIds) {
    const documents = await this.rangerModel
      .find({ rangerId: { $in: rangerIds } })
      .sort({ name: 1 })
      .lean();
    return documents.map(toRanger);
  }

  /** @param {string} userEmail @returns {Promise<object|null>} */
  async findByUserEmail(userEmail) {
    const filter = { userEmail: String(userEmail).trim().toLowerCase() };
    return toRanger(await this.rangerModel.findOne(filter).lean());
  }

  /**
   * @param {string} rangerId
   * @param {{ trackingStatus?: string, lastSyncTime?: Date, lastKnownLocation?: object }} changes
   * @returns {Promise<void>}
   */
  async updateTracking(rangerId, changes) {
    await this.rangerModel.updateOne({ rangerId }, { $set: changes });
  }
}

module.exports = RangerRepository;
