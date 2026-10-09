'use strict';

const CoverageStrategy = require('./CoverageStrategy');

/**
 * PATTERN-Strategy (default): a zone is covered by the share of its route
 * waypoints that a ranger passed within the waypoint radius (200 m).
 * A visited waypoint counts fully, whenever the visit happened.
 */
class ZoneProximityCoverageStrategy extends CoverageStrategy {
  /**
   * @param {Date|null} lastVisitedAt
   * @returns {number} 1 when visited, otherwise 0
   */
  scoreWaypoint(lastVisitedAt) {
    return lastVisitedAt ? 1 : 0;
  }
}

module.exports = ZoneProximityCoverageStrategy;
