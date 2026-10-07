'use strict';

const { ParkReader, ZoneReader, RouteReader } = require('./patrolContracts');
const { Zone } = require('../models/patrolDomain');

/**
 * Zones and routes are embedded in the park document (composition), so
 * these three repositories all read the Park model. They stay separate
 * classes because each answers a different question for a different caller.
 */

/** PATTERN-Repository: MongoDB access for park details. */
class ParkRepository extends ParkReader {
  /** @param {import('mongoose').Model} parkModel injected Mongoose model */
  constructor(parkModel) {
    super();
    this.parkModel = parkModel;
  }

  /** @param {string} parkId @returns {Promise<object|null>} park without zones/routes */
  async findByParkId(parkId) {
    const park = await this.parkModel.findOne({ parkId }).lean();
    if (!park) return null;

    return {
      parkId: park.parkId,
      name: park.name,
      location: park.location,
      terrainType: park.terrainType,
    };
  }
}

/** PATTERN-Repository: MongoDB access for zones. */
class ZoneRepository extends ZoneReader {
  /** @param {import('mongoose').Model} parkModel injected Mongoose model */
  constructor(parkModel) {
    super();
    this.parkModel = parkModel;
  }

  /** @returns {Promise<Zone[]>} zones of every park */
  async findAll() {
    return this.#load({});
  }

  /** @param {string} parkId @returns {Promise<Zone[]>} */
  async findByParkId(parkId) {
    return this.#load({ parkId });
  }

  async #load(filter) {
    const parks = await this.parkModel.find(filter).lean();
    return parks.flatMap((park) =>
      park.zones.map((zone) => new Zone({ ...zone, parkId: park.parkId })),
    );
  }
}

/** PATTERN-Repository: MongoDB access for patrol routes. */
class RouteRepository extends RouteReader {
  /** @param {import('mongoose').Model} parkModel injected Mongoose model */
  constructor(parkModel) {
    super();
    this.parkModel = parkModel;
  }

  /** @returns {Promise<object[]>} routes of every park */
  async findAll() {
    return this.#load({});
  }

  /** @param {string} parkId @returns {Promise<object[]>} */
  async findByParkId(parkId) {
    return this.#load({ parkId });
  }

  /** @param {string} routeId @returns {Promise<object|null>} */
  async findByRouteId(routeId) {
    const routes = await this.#load({ 'routes.routeId': routeId });
    return routes.find((route) => route.routeId === routeId) ?? null;
  }

  async #load(filter) {
    const parks = await this.parkModel.find(filter).lean();
    return parks.flatMap((park) => park.routes.map((route) => ({ ...route, parkId: park.parkId })));
  }
}

module.exports = { ParkRepository, ZoneRepository, RouteRepository };
