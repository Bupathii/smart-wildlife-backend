'use strict';

/**
 * Pure calculation classes for patrol monitoring. None of them touches the
 * database, HTTP or the GPS service, which keeps each one small and easy
 * to unit test.
 */

const { PatrolStatus } = require('../constants/patrolEnums');
const { PatrolCoverage } = require('../models/patrolDomain');
const { distanceAlongRouteKm, haversineKm, routeLengthKm, roundTo } = require('../utils/geo');

const FULL_PERCENTAGE = 100;
const DISTANCE_DECIMALS = 2;
const MILLISECONDS_PER_HOUR = 3_600_000;

const toTime = (value) => new Date(value).getTime();

/**
 * SOLID-S: calculates how far a patrol has progressed along its route and
 * nothing else. Controllers and other services ask it instead of doing
 * the maths themselves (avoids the "feature envy" smell).
 */
class PatrolProgressCalculator {
  /**
   * Progress is the furthest distance reached along the route, as a share
   * of the route length.
   * @param {{ waypoints: object[] }} route
   * @param {object[]} track recorded LocationPoints
   * @returns {{ progressPercentage: number, distanceCoveredKm: number }} never above 100 %
   */
  calculate(route, track) {
    const lengthKm = routeLengthKm(route.waypoints);
    if (lengthKm === 0 || track.length === 0) {
      return { progressPercentage: 0, distanceCoveredKm: 0 };
    }

    const furthestKm = track.reduce(
      (furthest, point) => Math.max(furthest, distanceAlongRouteKm(route.waypoints, point)),
      0,
    );
    const coveredKm = Math.min(furthestKm, lengthKm);

    return {
      progressPercentage: roundTo((coveredKm / lengthKm) * FULL_PERCENTAGE),
      distanceCoveredKm: roundTo(coveredKm, DISTANCE_DECIMALS),
    };
  }
}

/** The newest track point inside the zone, or null when there is none. */
function lastPatrolledAt(zone, patrols) {
  let latest = null;

  for (const point of patrols.flatMap((patrol) => patrol.track)) {
    if (!zone.contains(point)) continue;
    const visitedAt = toTime(point.timestamp);
    if (latest === null || visitedAt > latest) latest = visitedAt;
  }

  return latest === null ? null : new Date(latest);
}

/**
 * SOLID-S: turns patrol tracks into coverage figures per zone.
 * SOLID-D: the calculation itself is delegated to an injected
 * CoverageStrategy, so this class does not know which formula is in use.
 */
class ZoneCoverageAnalyzer {
  /** @param {{ coverageStrategy: import('../strategies/CoverageStrategy') }} deps */
  constructor({ coverageStrategy }) {
    this.coverageStrategy = coverageStrategy;
  }

  /**
   * @param {{ zones: object[], routes: object[], patrols: object[], now: Date }} input
   * @returns {{ coverage: PatrolCoverage, zoneStats: Array<{zoneId:string, name:string, percentage:number, lastPatrolledAt:Date|null}> }}
   */
  analyze({ zones, routes, patrols, now }) {
    const zoneCoverage = this.coverageStrategy.calculateZoneCoverage({
      zones,
      routes,
      patrols,
      now,
    });
    const coverage = new PatrolCoverage({
      coverageId: `COV-${now.getTime()}`,
      calculatedAt: now,
      zoneCoverage,
    });
    coverage.calculateCoverage();

    const zoneStats = zones.map((zone, index) => ({
      zoneId: zone.zoneId,
      name: zone.name,
      percentage: zoneCoverage[index].percentage,
      lastPatrolledAt: lastPatrolledAt(zone, patrols),
    }));

    return { coverage, zoneStats };
  }
}

/**
 * Under-patrolled rule: coverage is below the threshold.
 * A zone exactly on the threshold is acceptable.
 */
class LowCoverageRule {
  /** @param {{ thresholdPercent: number }} options */
  constructor({ thresholdPercent }) {
    this.thresholdPercent = thresholdPercent;
  }

  /** @returns {string|null} the reason, or null when the zone passes */
  check(zoneStat) {
    if (zoneStat.percentage >= this.thresholdPercent) return null;
    return `Coverage is below ${this.thresholdPercent}%`;
  }
}

/** Under-patrolled rule: no patrol has entered the zone within the window. */
class NotRecentlyPatrolledRule {
  /** @param {{ windowHours: number }} options */
  constructor({ windowHours }) {
    this.windowHours = windowHours;
  }

  /** @returns {string|null} the reason, or null when the zone passes */
  check(zoneStat, now) {
    const reason = `Not patrolled in the last ${this.windowHours} hours`;
    if (!zoneStat.lastPatrolledAt) return reason;

    const ageHours = (now.getTime() - toTime(zoneStat.lastPatrolledAt)) / MILLISECONDS_PER_HOUR;
    return ageHours >= this.windowHours ? reason : null;
  }
}

/**
 * SOLID-S: finds patrol gaps only.
 * SOLID-O: it applies whatever rule objects it is given. A new rule is a
 * new class with a check() method added to the list in the container;
 * this class is never edited.
 */
class UnderPatrolledZoneDetector {
  /** @param {{ rules: Array<{ check: (zoneStat: object, now: Date) => string|null }> }} deps */
  constructor({ rules }) {
    this.rules = rules;
  }

  /**
   * @param {object[]} zoneStats output of ZoneCoverageAnalyzer
   * @param {Date} now
   * @returns {object[]} the under-patrolled zones, each with its `reasons`
   */
  detect(zoneStats, now) {
    return zoneStats
      .map((zoneStat) => ({
        ...zoneStat,
        reasons: this.rules.map((rule) => rule.check(zoneStat, now)).filter(Boolean),
      }))
      .filter((zoneStat) => zoneStat.reasons.length > 0);
  }
}

/** SOLID-S: builds the ordered list of events shown as a patrol's timeline. */
class PatrolTimelineBuilder {
  /** @param {{ waypointRadiusKm: number }} options */
  constructor({ waypointRadiusKm }) {
    this.waypointRadiusKm = waypointRadiusKm;
  }

  /**
   * @param {object} patrol
   * @param {{ waypoints: object[] }} route
   * @returns {Array<{ type: string, label: string, timestamp: Date }>} oldest first
   */
  build(patrol, route) {
    const events = [{ type: 'STARTED', label: 'Patrol started', timestamp: patrol.startTime }];

    route.waypoints.forEach((waypoint, index) => {
      const reached = patrol.track.find(
        (point) => haversineKm(waypoint, point) <= this.waypointRadiusKm,
      );
      if (reached) {
        events.push({
          type: 'WAYPOINT',
          label: `Waypoint ${index + 1} reached`,
          timestamp: reached.timestamp,
          waypointIndex: index,
        });
      }
    });

    if (patrol.status === PatrolStatus.COMPLETED && patrol.endTime) {
      events.push({ type: 'COMPLETED', label: 'Patrol completed', timestamp: patrol.endTime });
    }

    return events.sort((a, b) => toTime(a.timestamp) - toTime(b.timestamp));
  }
}

module.exports = {
  PatrolProgressCalculator,
  ZoneCoverageAnalyzer,
  LowCoverageRule,
  NotRecentlyPatrolledRule,
  UnderPatrolledZoneDetector,
  PatrolTimelineBuilder,
};
