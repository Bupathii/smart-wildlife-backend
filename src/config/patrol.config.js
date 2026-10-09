'use strict';

/**
 * Central configuration for the "Monitor and Evaluate Ranger Patrol
 * Activities" use case. Every threshold lives here so that no business
 * class contains a magic number.
 */
const patrolConfig = Object.freeze({
  /** A zone below this coverage percentage is under-patrolled. */
  COVERAGE_THRESHOLD_PERCENT: 40,

  /** A zone with no patrol activity for longer than this is under-patrolled. */
  UNDER_PATROLLED_WINDOW_HOURS: 48,

  /** A GPS fix older than this is treated as "no fix" (ranger OFFLINE). */
  OFFLINE_AFTER_MINUTES: 15,

  /** A waypoint counts as visited when a track point is within this distance. */
  WAYPOINT_RADIUS_KM: 0.2,

  /** "Recently completed" patrols are those completed within this window. */
  RECENT_COMPLETED_HOURS: 24,

  /** How often the dashboard refreshes itself. */
  REFRESH_INTERVAL_SECONDS: 30,

  /** Which CoverageStrategy the container wires in (see strategies/index.js). */
  COVERAGE_STRATEGY: 'ZONE_PROXIMITY',

  EVALUATION: Object.freeze({
    MIN_RATING: 1,
    MAX_RATING: 5,
    NOTES_MAX_LENGTH: 500,
    /** Notes become mandatory when the rating is at or below this value. */
    NOTES_REQUIRED_AT_OR_BELOW: 2,
  }),

  ROUTE: Object.freeze({
    MIN_WAYPOINTS: 2,
    MAX_WAYPOINTS: 50,
    NAME_MAX_LENGTH: 80,
    DESCRIPTION_MAX_LENGTH: 300,
  }),

  PATROL_PLAN: Object.freeze({
    MAX_RANGERS: 6,
    MAX_DURATION_HOURS: 24,
  }),

  /** Positions reported by rangers' phones (mobile app). */
  DEVICE_TRACKING: Object.freeze({
    MAX_POINTS_PER_REQUEST: 200,
    /** A point this recent is live GPS; older ones were stored offline (SYNCHRONIZED). */
    LIVE_WITHIN_SECONDS: 120,
    /** Allowance for a phone clock that runs slightly ahead. */
    FUTURE_TOLERANCE_SECONDS: 300,
  }),

  SIMULATED_GPS: Object.freeze({
    /** Distance a simulated ranger moves along the route per GPS request. */
    STEP_KM: 0.12,
    /** Rangers whose simulated device never returns a fix. */
    OFFLINE_RANGER_IDS: Object.freeze(['RN-003']),
  }),

  /** Percentages are reported with this many decimal places. */
  PERCENTAGE_DECIMALS: 1,
});

module.exports = patrolConfig;
