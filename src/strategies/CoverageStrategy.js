'use strict';

const { haversineKm, roundTo } = require('../utils/geo');
const { PERCENTAGE_DECIMALS } = require('../config/patrol.config');

const FULL_PERCENTAGE = 100;

/** Every waypoint of every route that lies inside the zone. */
function waypointsInZone(zone, routes) {
  return routes.flatMap((route) => route.waypoints).filter((waypoint) => zone.contains(waypoint));
}

/**
 * When the waypoint was last visited: the newest track point within the
 * radius. Returns null when it was never visited.
 */
function latestVisit(waypoint, trackPoints, radiusKm) {
  let latest = null;

  for (const point of trackPoints) {
    if (haversineKm(waypoint, point) > radiusKm) continue;
    const visitedAt = new Date(point.timestamp).getTime();
    if (latest === null || visitedAt > latest) latest = visitedAt;
  }

  return latest === null ? null : new Date(latest);
}

/**
 * PATTERN-Strategy: the family of interchangeable coverage calculations.
 *
 * SOLID-O: a new way of measuring coverage is added by writing a new
 * subclass and registering it in strategies/index.js. ZoneCoverageAnalyzer
 * and PatrolMonitoringService are not edited.
 *
 * PATTERN-TemplateMethod: calculateZoneCoverage() fixes the algorithm
 * (find the zone's waypoints, score each one, average the scores) and
 * subclasses supply only scoreWaypoint().
 */
class CoverageStrategy {
  /** @param {{ waypointRadiusKm: number }} options */
  constructor({ waypointRadiusKm }) {
    this.waypointRadiusKm = waypointRadiusKm;
  }

  /**
   * @param {{ zones: object[], routes: object[], patrols: object[], now: Date }} input
   * @returns {Array<{ zoneId: string, percentage: number }>} one entry per zone, 0..100
   */
  calculateZoneCoverage({ zones, routes, patrols, now }) {
    const trackPoints = patrols.flatMap((patrol) => patrol.track);

    return zones.map((zone) => ({
      zoneId: zone.zoneId,
      percentage: this.#zonePercentage(waypointsInZone(zone, routes), trackPoints, now),
    }));
  }

  /**
   * How much one waypoint contributes to coverage.
   * @param {Date|null} _lastVisitedAt null when never visited
   * @param {Date} _now
   * @returns {number} a score from 0 (not covered) to 1 (fully covered)
   */
  scoreWaypoint(_lastVisitedAt, _now) {
    throw new Error('CoverageStrategy.scoreWaypoint() is not implemented');
  }

  #zonePercentage(waypoints, trackPoints, now) {
    if (waypoints.length === 0) return 0;

    const total = waypoints.reduce((sum, waypoint) => {
      const lastVisitedAt = latestVisit(waypoint, trackPoints, this.waypointRadiusKm);
      return sum + this.scoreWaypoint(lastVisitedAt, now);
    }, 0);

    return roundTo((total / waypoints.length) * FULL_PERCENTAGE, PERCENTAGE_DECIMALS);
  }
}

module.exports = CoverageStrategy;
