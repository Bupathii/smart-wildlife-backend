'use strict';

const GpsTrackingService = require('./GpsTrackingService');
const { LocationPoint } = require('../models/patrolDomain');
const { GpsServiceUnavailableError } = require('../errors/patrolErrors');

/**
 * PATTERN-Adapter: makes the positions that rangers' phones report look
 * like the GPS Tracking Service the rest of the system already uses.
 *
 * A ranger who signs in to the mobile app (their record has a userEmail)
 * is located from the last position their phone sent. Every other ranger
 * is passed to the fallback service (the simulator), so sample rangers
 * keep moving in a demo.
 *
 * SOLID-O / SOLID-L: real phone tracking was added as this new subclass.
 * RangerLocationService and PatrolMonitoringService were not changed,
 * because it honours the same GpsTrackingService contract.
 */
class DeviceFirstGpsTrackingService extends GpsTrackingService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').RangerReader} deps.rangerReader
   * @param {GpsTrackingService} deps.fallback used for rangers without a phone
   * @param {() => boolean} deps.isDown true while the service is unreachable
   */
  constructor({ rangerReader, fallback, isDown }) {
    super();
    this.rangerReader = rangerReader;
    this.fallback = fallback;
    this.isDown = isDown;
  }

  /**
   * @param {string} rangerId
   * @returns {Promise<LocationPoint|null>} the phone's last reported position;
   *          null when it has never reported (an old position is returned as
   *          it is - the caller decides whether it is too old to trust)
   * @throws {GpsServiceUnavailableError} when the service is down
   */
  async getCurrentLocation(rangerId) {
    if (this.isDown()) throw new GpsServiceUnavailableError();

    const ranger = await this.rangerReader.findByRangerId(rangerId);
    if (!ranger?.userEmail) return this.fallback.getCurrentLocation(rangerId);

    return LocationPoint.from(ranger.lastKnownLocation);
  }
}

module.exports = DeviceFirstGpsTrackingService;
