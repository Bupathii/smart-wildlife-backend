'use strict';

const CoverageStrategy = require('./CoverageStrategy');

const MILLISECONDS_PER_HOUR = 3_600_000;

/**
 * PATTERN-Strategy (alternative): like the proximity strategy, but a visit
 * loses value as it gets older. A waypoint visited now scores 1; one
 * visited a full window ago (48 h by default) scores 0.
 *
 * SOLID-O: this class was added without changing any existing class.
 */
class TimeWeightedCoverageStrategy extends CoverageStrategy {
  /** @param {{ waypointRadiusKm: number, windowHours: number }} options */
  constructor({ waypointRadiusKm, windowHours }) {
    super({ waypointRadiusKm });
    this.windowHours = windowHours;
  }

  /**
   * @param {Date|null} lastVisitedAt
   * @param {Date} now
   * @returns {number} 0..1, falling linearly with the age of the visit
   */
  scoreWaypoint(lastVisitedAt, now) {
    if (!lastVisitedAt) return 0;

    const ageHours = (now.getTime() - lastVisitedAt.getTime()) / MILLISECONDS_PER_HOUR;
    const freshness = 1 - ageHours / this.windowHours;

    return Math.min(1, Math.max(0, freshness));
  }
}

module.exports = TimeWeightedCoverageStrategy;
