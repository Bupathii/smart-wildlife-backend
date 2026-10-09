'use strict';

const GpsTrackingService = require('./GpsTrackingService');
const { LocationPoint } = require('../models/patrolDomain');
const { LocationSource } = require('../constants/patrolEnums');
const { GpsServiceUnavailableError } = require('../errors/patrolErrors');

/**
 * PATTERN-Adapter: converts the provider's API (fetchFix returning
 * { lat, lng, recordedAt } and throwing plain errors) into the interface
 * the rest of the system expects (GpsTrackingService returning a
 * LocationPoint and throwing GpsServiceUnavailableError).
 *
 * Swapping the simulator for a real provider later means writing one new
 * adapter; no service changes.
 */
class SimulatedGpsTrackingService extends GpsTrackingService {
  /**
   * @param {{ provider: { fetchFix: (deviceId: string) => Promise<object|null> } }} deps
   */
  constructor({ provider }) {
    super();
    this.provider = provider;
  }

  /**
   * @param {string} rangerId
   * @returns {Promise<LocationPoint|null>} null when the ranger has no fix
   * @throws {GpsServiceUnavailableError} when the provider cannot be reached
   */
  async getCurrentLocation(rangerId) {
    const fix = await this.#fetchFix(rangerId);
    if (!fix) return null;

    return new LocationPoint({
      latitude: fix.lat,
      longitude: fix.lng,
      timestamp: fix.recordedAt,
      source: LocationSource.GPS,
    });
  }

  async #fetchFix(rangerId) {
    try {
      return await this.provider.fetchFix(rangerId);
    } catch (error) {
      // Translate the provider's error into the one our services understand.
      throw new GpsServiceUnavailableError(`GPS Tracking Service is unavailable: ${error.message}`);
    }
  }
}

module.exports = SimulatedGpsTrackingService;
