'use strict';

/**
 * Services behind the Patrol Monitoring Dashboard (main flow steps 1-12).
 * Each class has one job; PatrolMonitoringService only coordinates them.
 */

const { GpsStatus, PatrolStatus, TrackingStatus } = require('../constants/patrolEnums');
const { GpsServiceUnavailableError, NotFoundError } = require('../errors/patrolErrors');
const { LocationPoint } = require('../models/patrolDomain');

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;

const toTime = (value) => new Date(value).getTime();
const hoursBefore = (date, hours) => new Date(date.getTime() - hours * MILLISECONDS_PER_HOUR);
const indexBy = (items, key) => new Map(items.map((item) => [item[key], item]));

/** The ranger fields shown on screen, with optional live overrides. */
function toRangerView(ranger, overrides = {}) {
  return {
    rangerId: ranger.rangerId,
    name: ranger.name,
    rank: ranger.rank,
    phoneNumber: ranger.phoneNumber,
    trackingStatus: ranger.trackingStatus,
    lastSyncTime: ranger.lastSyncTime ?? null,
    location: ranger.lastKnownLocation ?? null,
    ...overrides,
  };
}

/** Returns a copy of the context that uses the given (live) ranger views. */
function withRangerViews(context, rangerViews) {
  const merged = new Map(context.rangerViews);
  rangerViews.forEach((view) => merged.set(view.rangerId, view));
  return { ...context, rangerViews: merged };
}

/**
 * SOLID-S: obtains ranger locations from the GPS Tracking Service and
 * applies the fallback rules (EX1 ranger offline, EX3 service unavailable).
 * SOLID-D: depends on the GpsTrackingService abstraction, a repository
 * contract, a clock and a logger - all injected.
 */
class RangerLocationService {
  /**
   * @param {object} deps
   * @param {import('../gps/GpsTrackingService')} deps.gpsService
   * @param {object} deps.rangerRepository RangerReader + RangerTrackingWriter
   * @param {() => Date} deps.clock
   * @param {object} deps.logger
   * @param {number} deps.offlineAfterMinutes a fix older than this is ignored
   */
  constructor({ gpsService, rangerRepository, clock, logger, offlineAfterMinutes }) {
    this.gpsService = gpsService;
    this.rangerRepository = rangerRepository;
    this.clock = clock;
    this.logger = logger;
    this.offlineAfterMs = offlineAfterMinutes * MILLISECONDS_PER_MINUTE;
  }

  /**
   * @param {object[]} rangers stored ranger records
   * @returns {Promise<{ gpsStatus: string, rangers: object[], freshFixes: Map<string, LocationPoint> }>}
   */
  async resolveLocations(rangers) {
    const fixes = await this.#fetchFixes(rangers);
    if (!fixes) {
      // EX3: service unavailable - show the last synchronised data untouched.
      const stored = rangers.map((ranger) => toRangerView(ranger));
      return { gpsStatus: GpsStatus.UNAVAILABLE, rangers: stored, freshFixes: new Map() };
    }

    const now = this.clock();
    const freshFixes = new Map();
    const views = [];
    for (const ranger of rangers) {
      const fix = fixes.get(ranger.rangerId);
      const fresh = this.#isFresh(fix, now);
      if (fresh) freshFixes.set(ranger.rangerId, fix);
      views.push(fresh ? await this.#markOnline(ranger, fix) : await this.#markOffline(ranger));
    }

    return { gpsStatus: GpsStatus.AVAILABLE, rangers: views, freshFixes };
  }

  /**
   * Re-queries the GPS service for one ranger (the Retry button, EX1).
   * @param {string} rangerId
   * @returns {Promise<object>} ranger view plus `gpsStatus`
   * @throws {NotFoundError} when the ranger does not exist
   */
  async locateRanger(rangerId) {
    const ranger = await this.rangerRepository.findByRangerId(rangerId);
    if (!ranger) throw new NotFoundError(`Ranger ${rangerId} was not found`);

    const { gpsStatus, rangers } = await this.resolveLocations([ranger]);
    return { ...rangers[0], gpsStatus };
  }

  /** @returns {Promise<Map|null>} fixes per ranger, or null when the service is down */
  async #fetchFixes(rangers) {
    const fixes = new Map();
    try {
      for (const ranger of rangers) {
        fixes.set(ranger.rangerId, await this.gpsService.getCurrentLocation(ranger.rangerId));
      }
      return fixes;
    } catch (error) {
      // Only the "service down" case has a fallback; anything else is a real fault.
      if (!(error instanceof GpsServiceUnavailableError)) throw error;
      this.logger.warn('GPS Tracking Service unavailable; using stored locations', error.message);
      return null;
    }
  }

  #isFresh(fix, now) {
    if (!fix || !fix.isValid() || !fix.timestamp) return false;
    return now.getTime() - fix.timestamp.getTime() <= this.offlineAfterMs;
  }

  async #markOnline(ranger, fix) {
    const changes = {
      trackingStatus: TrackingStatus.ONLINE,
      lastSyncTime: fix.timestamp,
      lastKnownLocation: fix.toJSON(),
    };
    await this.rangerRepository.updateTracking(ranger.rangerId, changes);
    return toRangerView(ranger, { ...changes, location: changes.lastKnownLocation });
  }

  async #markOffline(ranger) {
    // EX1: keep the last known location and flag the ranger as offline.
    if (ranger.trackingStatus !== TrackingStatus.OFFLINE) {
      await this.rangerRepository.updateTracking(ranger.rangerId, {
        trackingStatus: TrackingStatus.OFFLINE,
      });
    }
    return toRangerView(ranger, { trackingStatus: TrackingStatus.OFFLINE });
  }
}

/**
 * SOLID-S: stores newly received GPS fixes on the track of the patrol the
 * ranger is on. Kept apart from PatrolMonitoringService so that service
 * stays read-only.
 */
class PatrolTrackRecorder {
  /** @param {{ trackWriter: import('../repositories/patrolContracts').TrackWriter }} deps */
  constructor({ trackWriter }) {
    this.trackWriter = trackWriter;
  }

  /**
   * @param {object[]} patrols patrols currently in the field
   * @param {Map<string, LocationPoint>} freshFixes fix per ranger id
   * @returns {Promise<object[]>} the patrols with their tracks extended
   */
  async record(patrols, freshFixes) {
    return Promise.all(patrols.map((patrol) => this.#recordOne(patrol, freshFixes)));
  }

  async #recordOne(patrol, freshFixes) {
    // One point per patrol is enough: its rangers travel together.
    const rangerId = patrol.rangerIds.find((id) => freshFixes.has(id));
    if (!rangerId) return patrol;

    const point = LocationPoint.from(freshFixes.get(rangerId)).toJSON();
    await this.trackWriter.appendTrackPoint(patrol.patrolId, point);
    return { ...patrol, track: [...patrol.track, point] };
  }
}

/**
 * SOLID-S: loads the routes, zones and rangers that a set of patrols
 * refers to. Shared by the monitoring and query services, so the lookup
 * code exists once (no duplicate code).
 */
class PatrolContextLoader {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').RangerReader} deps.rangerReader
   * @param {import('../repositories/patrolContracts').RouteReader} deps.routeReader
   * @param {import('../repositories/patrolContracts').ZoneReader} deps.zoneReader
   */
  constructor({ rangerReader, routeReader, zoneReader }) {
    this.rangerReader = rangerReader;
    this.routeReader = routeReader;
    this.zoneReader = zoneReader;
  }

  /**
   * @param {object[]} patrols
   * @returns {Promise<{ routes: object[], zones: object[], rangers: object[], routesById: Map, rangerViews: Map }>}
   */
  async load(patrols) {
    const rangerIds = [...new Set(patrols.flatMap((patrol) => patrol.rangerIds))];
    const [routes, zones, rangers] = await Promise.all([
      this.routeReader.findAll(),
      this.zoneReader.findAll(),
      this.rangerReader.findByRangerIds(rangerIds),
    ]);

    return {
      routes,
      zones,
      rangers,
      routesById: indexBy(routes, 'routeId'),
      rangerViews: indexBy(
        rangers.map((ranger) => toRangerView(ranger)),
        'rangerId',
      ),
    };
  }
}

/**
 * SOLID-S: shapes one patrol for display (list row, details, coverage).
 * It asks the calculators for the numbers; it does not compute them.
 */
class PatrolViewAssembler {
  /**
   * @param {object} deps
   * @param {object} deps.progressCalculator PatrolProgressCalculator
   * @param {object} deps.coverageAnalyzer ZoneCoverageAnalyzer
   * @param {object} deps.timelineBuilder PatrolTimelineBuilder
   * @param {number} deps.coverageThresholdPercent
   */
  constructor({ progressCalculator, coverageAnalyzer, timelineBuilder, coverageThresholdPercent }) {
    this.progressCalculator = progressCalculator;
    this.coverageAnalyzer = coverageAnalyzer;
    this.timelineBuilder = timelineBuilder;
    this.coverageThresholdPercent = coverageThresholdPercent;
  }

  /** @returns {object} one row of a patrol list */
  toView(patrol, context, now) {
    return this.#summary(patrol, context, this.#analyze(patrol, context, now), now);
  }

  /** @returns {object} everything shown on the Patrol Details screen */
  toDetailView(patrol, context, now) {
    const analysis = this.#analyze(patrol, context, now);
    const lowZoneIds = analysis.coverage
      .identifyUnderPatrolledZones(this.coverageThresholdPercent)
      .map((zone) => zone.zoneId);

    return {
      ...this.#summary(patrol, context, analysis, now),
      route: analysis.route,
      track: patrol.track,
      zoneCoverage: analysis.zoneStats,
      areasNeedingAttention: analysis.zoneStats.filter((zone) => lowZoneIds.includes(zone.zoneId)),
      timeline: this.timelineBuilder.build(patrol, analysis.route),
      canEvaluate: patrol.status === PatrolStatus.COMPLETED,
    };
  }

  /** @returns {object} coverage of one patrol, broken down by zone */
  toCoverageView(patrol, context, now) {
    const { coverage, zoneStats } = this.#analyze(patrol, context, now);
    return { patrolId: patrol.patrolId, ...coverage.toJSON(), zoneCoverage: zoneStats };
  }

  #analyze(patrol, context, now) {
    const route = context.routesById.get(patrol.routeId);
    if (!route) {
      throw new Error(`Route ${patrol.routeId} of patrol ${patrol.patrolId} is missing`);
    }

    const completed = patrol.status === PatrolStatus.COMPLETED && patrol.endTime;
    const { coverage, zoneStats } = this.coverageAnalyzer.analyze({
      zones: context.zones.filter((zone) => route.zoneIds.includes(zone.zoneId)),
      routes: [route],
      patrols: [patrol],
      now: completed ? new Date(patrol.endTime) : now,
    });

    return {
      route,
      coverage,
      zoneStats,
      progress: this.progressCalculator.calculate(route, patrol.track),
    };
  }

  #summary(patrol, context, analysis, now) {
    const completed = patrol.status === PatrolStatus.COMPLETED && patrol.endTime;
    const endedAt = completed ? toTime(patrol.endTime) : now.getTime();
    const { route, progress, coverage } = analysis;

    return {
      patrolId: patrol.patrolId,
      status: patrol.status,
      startTime: patrol.startTime,
      endTime: patrol.endTime ?? null,
      durationMinutes: Math.round((endedAt - toTime(patrol.startTime)) / MILLISECONDS_PER_MINUTE),
      route: { routeId: route.routeId, name: route.name, routeLength: route.routeLength },
      rangers: patrol.rangerIds.map((id) => context.rangerViews.get(id)).filter(Boolean),
      progressPercentage: progress.progressPercentage,
      distanceCoveredKm: progress.distanceCoveredKm,
      coveragePercentage: coverage.percentage,
      lastUpdate: patrol.track.at(-1)?.timestamp ?? patrol.startTime,
      evaluation: patrol.evaluation ?? null,
    };
  }
}

/**
 * SOLID-S: builds the monitoring dashboard by coordinating its
 * collaborators. It contains no geometry, no GPS fallback logic and no
 * database code (the opposite of Group 059's WildlifeMonitoringSystem
 * god class).
 * SOLID-I: of all the repository contracts it uses only PatrolReader.
 * SOLID-D: every collaborator arrives through the constructor.
 */
class PatrolMonitoringService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').PatrolReader} deps.patrolReader
   * @param {PatrolContextLoader} deps.contextLoader
   * @param {RangerLocationService} deps.locationService
   * @param {PatrolTrackRecorder} deps.trackRecorder
   * @param {PatrolViewAssembler} deps.viewAssembler
   * @param {object} deps.coverageAnalyzer ZoneCoverageAnalyzer
   * @param {object} deps.underPatrolledDetector UnderPatrolledZoneDetector
   * @param {() => Date} deps.clock
   * @param {object} deps.config patrol configuration
   */
  constructor(deps) {
    this.patrolReader = deps.patrolReader;
    this.contextLoader = deps.contextLoader;
    this.locationService = deps.locationService;
    this.trackRecorder = deps.trackRecorder;
    this.viewAssembler = deps.viewAssembler;
    this.coverageAnalyzer = deps.coverageAnalyzer;
    this.underPatrolledDetector = deps.underPatrolledDetector;
    this.clock = deps.clock;
    this.config = deps.config;
  }

  /**
   * Main flow steps 2-8: patrols, live locations, progress, coverage and
   * under-patrolled zones in one response.
   * @returns {Promise<object>} the dashboard
   */
  async getDashboard() {
    const now = this.clock();
    const windowStart = hoursBefore(now, this.config.UNDER_PATROLLED_WINDOW_HOURS);
    const [inProgress, completedInWindow] = await Promise.all([
      this.patrolReader.findInProgress(),
      this.patrolReader.findCompletedSince(windowStart),
    ]);

    const context = await this.contextLoader.load([...inProgress, ...completedInWindow]);
    const onPatrol = context.rangers.filter((ranger) =>
      inProgress.some((patrol) => patrol.rangerIds.includes(ranger.rangerId)),
    );
    const tracking = await this.locationService.resolveLocations(onPatrol);
    const active = await this.trackRecorder.record(inProgress, tracking.freshFixes);

    const patrols = { active, completedInWindow };
    return this.#buildDashboard({ now, patrols, tracking, context });
  }

  #buildDashboard({ now, patrols, tracking, context }) {
    const liveContext = withRangerViews(context, tracking.rangers);
    const { coverage, zoneStats } = this.coverageAnalyzer.analyze({
      zones: context.zones,
      routes: context.routes,
      patrols: [...patrols.active, ...patrols.completedInWindow],
      now,
    });
    const underPatrolledZones = this.underPatrolledDetector.detect(zoneStats, now);
    const flaggedIds = underPatrolledZones.map((zone) => zone.zoneId);
    const recentStart = hoursBefore(now, this.config.RECENT_COMPLETED_HOURS).getTime();
    const toView = (patrol) => this.viewAssembler.toView(patrol, liveContext, now);

    return {
      lastUpdated: now,
      gpsStatus: tracking.gpsStatus,
      refreshIntervalSeconds: this.config.REFRESH_INTERVAL_SECONDS,
      noActivePatrols: patrols.active.length === 0,
      summary: this.#summary(patrols.active, tracking.rangers, coverage, underPatrolledZones),
      activePatrols: patrols.active.map(toView),
      recentlyCompleted: patrols.completedInWindow
        .filter((patrol) => toTime(patrol.endTime) >= recentStart)
        .map(toView),
      zoneCoverage: zoneStats.map((zone) => ({
        ...zone,
        underPatrolled: flaggedIds.includes(zone.zoneId),
      })),
      underPatrolledZones,
    };
  }

  #summary(active, rangerViews, coverage, underPatrolledZones) {
    const online = rangerViews.filter((view) => view.trackingStatus === TrackingStatus.ONLINE);

    return {
      activePatrols: active.length,
      rangersOnline: online.length,
      rangersOffline: rangerViews.length - online.length,
      averageCoverage: coverage.percentage,
      underPatrolledZones: underPatrolledZones.length,
    };
  }
}

module.exports = {
  toRangerView,
  withRangerViews,
  RangerLocationService,
  PatrolTrackRecorder,
  PatrolContextLoader,
  PatrolViewAssembler,
  PatrolMonitoringService,
};
