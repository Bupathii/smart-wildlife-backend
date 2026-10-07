'use strict';

/**
 * The GPS Tracking Service as this system sees it (secondary actor in the
 * use case). Written as an abstract class because JavaScript has no
 * interface keyword.
 *
 * SOLID-L: every subclass keeps the same contract, so any of them can
 * replace another without the caller changing:
 *   - resolves to a LocationPoint when the ranger has a fix
 *   - resolves to null when the ranger has no fix
 *   - rejects with GpsServiceUnavailableError when the service is down
 */
class GpsTrackingService {
  /**
   * @param {string} _rangerId
   * @returns {Promise<import('../models/patrolDomain').LocationPoint|null>}
   * @throws {import('../errors/patrolErrors').GpsServiceUnavailableError}
   */
  async getCurrentLocation(_rangerId) {
    throw new Error('GpsTrackingService.getCurrentLocation() is not implemented');
  }
}

module.exports = GpsTrackingService;
