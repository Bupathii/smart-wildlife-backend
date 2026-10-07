'use strict';

const ZoneProximityCoverageStrategy = require('./ZoneProximityCoverageStrategy');
const TimeWeightedCoverageStrategy = require('./TimeWeightedCoverageStrategy');

/**
 * PATTERN-Factory: maps the name in config.js to a strategy object.
 * SOLID-O: registering a new strategy is one new line here.
 */
const STRATEGY_BUILDERS = Object.freeze({
  ZONE_PROXIMITY: (config) =>
    new ZoneProximityCoverageStrategy({ waypointRadiusKm: config.WAYPOINT_RADIUS_KM }),
  TIME_WEIGHTED: (config) =>
    new TimeWeightedCoverageStrategy({
      waypointRadiusKm: config.WAYPOINT_RADIUS_KM,
      windowHours: config.UNDER_PATROLLED_WINDOW_HOURS,
    }),
});

/**
 * @param {object} config patrol configuration (uses COVERAGE_STRATEGY)
 * @returns {import('./CoverageStrategy')} the configured strategy
 */
function createCoverageStrategy(config) {
  const build = STRATEGY_BUILDERS[config.COVERAGE_STRATEGY];
  if (!build) {
    throw new Error(`Unknown coverage strategy "${config.COVERAGE_STRATEGY}"`);
  }
  return build(config);
}

module.exports = {
  createCoverageStrategy,
  ZoneProximityCoverageStrategy,
  TimeWeightedCoverageStrategy,
};
