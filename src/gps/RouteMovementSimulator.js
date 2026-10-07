'use strict';

const { distanceAlongRouteKm, pointAlongRoute } = require('../utils/geo');

/**
 * Stands in for the external GPS provider, because no real tracking
 * devices are used. It speaks the provider's own "foreign" format
 * ({ lat, lng, recordedAt }) and knows nothing about LocationPoint -
 * SimulatedGpsTrackingService adapts it.
 *
 * Each request moves the ranger a small step further along the route of
 * the patrol they are currently on, starting from the end of the track.
 */
class RouteMovementSimulator {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').PatrolReader} deps.patrolReader
   * @param {import('../repositories/patrolContracts').RouteReader} deps.routeReader
   * @param {() => Date} deps.clock
   * @param {() => boolean} deps.isDown true while the provider is unreachable
   * @param {() => string[]} deps.offlineRangerIds devices that never report
   * @param {number} deps.stepKm distance moved per request
   */
  constructor({ patrolReader, routeReader, clock, isDown, offlineRangerIds, stepKm }) {
    this.patrolReader = patrolReader;
    this.routeReader = routeReader;
    this.clock = clock;
    this.isDown = isDown;
    this.offlineRangerIds = offlineRangerIds;
    this.stepKm = stepKm;
  }

  /**
   * @param {string} deviceId the ranger id the device is registered to
   * @returns {Promise<{ lat: number, lng: number, recordedAt: Date }|null>} null = no signal
   */
  async fetchFix(deviceId) {
    if (this.isDown()) throw new Error('GPS provider connection refused');
    if (this.offlineRangerIds().includes(deviceId)) return null;

    const patrol = await this.#currentPatrolOf(deviceId);
    if (!patrol) return null;

    const route = await this.routeReader.findByRouteId(patrol.routeId);
    if (!route) return null;

    const position = this.#nextPosition(route.waypoints, patrol.track);
    return { lat: position.latitude, lng: position.longitude, recordedAt: this.clock() };
  }

  async #currentPatrolOf(rangerId) {
    const patrols = await this.patrolReader.findInProgress();
    return patrols.find((patrol) => patrol.rangerIds.includes(rangerId)) ?? null;
  }

  #nextPosition(waypoints, track) {
    const lastPoint = track.at(-1) ?? waypoints[0];
    const travelledKm = distanceAlongRouteKm(waypoints, lastPoint);
    return pointAlongRoute(waypoints, travelledKm + this.stepKm);
  }
}

module.exports = RouteMovementSimulator;
