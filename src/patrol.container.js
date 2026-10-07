'use strict';

/**
 * Composition root for "Monitor and Evaluate Ranger Patrol Activities".
 *
 * SOLID-D: this is the ONLY place where concrete classes are chosen and
 * connected. Services never call `new SomeRepository()` and never import
 * mongoose; they receive what they need through their constructors.
 * PATTERN-Factory: createPatrolModule(overrides) builds the whole object
 * graph, and tests pass fake repositories / GPS service / clock instead.
 */

const express = require('express');

const config = require('./config/patrol.config');
const { createConsoleLogger } = require('./utils/logger');
const { createCoverageStrategy } = require('./strategies');
const RouteMovementSimulator = require('./gps/RouteMovementSimulator');
const SimulatedGpsTrackingService = require('./gps/SimulatedGpsTrackingService');
const calculators = require('./services/patrolCalculators');
const monitoring = require('./services/patrolMonitoring.service');
const queries = require('./services/patrolQuery.service');
const evaluations = require('./services/patrolEvaluation.service');
const { createPatrolController } = require('./controllers/patrol.controller');
const { createPatrolRouters } = require('./routes/patrol.routes');
const { createPatrolErrorHandler } = require('./middleware/patrolError.middleware');

/** MongoDB-backed repositories, loaded only when no fakes are supplied. */
function createMongoRepositories() {
  const PatrolRepository = require('./repositories/PatrolRepository');
  const RangerRepository = require('./repositories/RangerRepository');
  const parkRepositories = require('./repositories/ParkRepositories');
  const Park = require('./models/Park');

  return {
    patrols: new PatrolRepository(require('./models/Patrol')),
    rangers: new RangerRepository(require('./models/Ranger')),
    parks: new parkRepositories.ParkRepository(Park),
    zones: new parkRepositories.ZoneRepository(Park),
    routes: new parkRepositories.RouteRepository(Park),
  };
}

/** The simulated GPS Tracking Service, controlled by environment flags. */
function createSimulatedGps(repositories, clock, env) {
  const provider = new RouteMovementSimulator({
    patrolReader: repositories.patrols,
    routeReader: repositories.routes,
    clock,
    stepKm: config.SIMULATED_GPS.STEP_KM,
    // GPS_DOWN=true demonstrates EX3 (service unavailable).
    isDown: () => env.GPS_DOWN === 'true',
    // GPS_OFFLINE_RANGERS=RN-003,RN-005 overrides who has no signal (EX1).
    offlineRangerIds: () =>
      env.GPS_OFFLINE_RANGERS === undefined
        ? config.SIMULATED_GPS.OFFLINE_RANGER_IDS
        : env.GPS_OFFLINE_RANGERS.split(',').map((id) => id.trim()),
  });

  return new SimulatedGpsTrackingService({ provider });
}

/** Builds the calculation objects, which need no I/O. */
function createCalculators(coverageStrategy, underPatrolledRules) {
  const coverageAnalyzer = new calculators.ZoneCoverageAnalyzer({ coverageStrategy });
  const defaultRules = [
    new calculators.LowCoverageRule({ thresholdPercent: config.COVERAGE_THRESHOLD_PERCENT }),
    new calculators.NotRecentlyPatrolledRule({ windowHours: config.UNDER_PATROLLED_WINDOW_HOURS }),
  ];

  return {
    coverageAnalyzer,
    underPatrolledDetector: new calculators.UnderPatrolledZoneDetector({
      rules: underPatrolledRules ?? defaultRules,
    }),
    viewAssembler: new monitoring.PatrolViewAssembler({
      progressCalculator: new calculators.PatrolProgressCalculator(),
      coverageAnalyzer,
      timelineBuilder: new calculators.PatrolTimelineBuilder({
        waypointRadiusKm: config.WAYPOINT_RADIUS_KM,
      }),
      coverageThresholdPercent: config.COVERAGE_THRESHOLD_PERCENT,
    }),
  };
}

/** The services that need neither GPS nor calculators. */
function createRecordServices(repositories, clock) {
  return {
    evaluationService: new evaluations.PatrolEvaluationService({
      // SOLID-I: the same repository object is handed over twice, each time
      // as a different small contract (PatrolReader / EvaluationWriter).
      patrolReader: repositories.patrols,
      evaluationWriter: repositories.patrols,
      validator: new evaluations.EvaluationValidator(),
      clock,
    }),
    referenceService: new queries.PatrolReferenceService({
      parkReader: repositories.parks,
      zoneReader: repositories.zones,
      routeReader: repositories.routes,
      rangerReader: repositories.rangers,
    }),
  };
}

/** Connects every service to its collaborators. */
function createServices({ repositories, gpsService, clock, logger, calc }) {
  const contextLoader = new monitoring.PatrolContextLoader({
    rangerReader: repositories.rangers,
    routeReader: repositories.routes,
    zoneReader: repositories.zones,
  });
  const locationService = new monitoring.RangerLocationService({
    gpsService,
    rangerRepository: repositories.rangers,
    clock,
    logger,
    offlineAfterMinutes: config.OFFLINE_AFTER_MINUTES,
  });
  const shared = { patrolReader: repositories.patrols, contextLoader, locationService, clock };

  return {
    ...createRecordServices(repositories, clock),
    locationService,
    monitoringService: new monitoring.PatrolMonitoringService({
      ...shared,
      ...calc,
      trackRecorder: new monitoring.PatrolTrackRecorder({ trackWriter: repositories.patrols }),
      config,
    }),
    queryService: new queries.PatrolQueryService({
      ...shared,
      viewAssembler: calc.viewAssembler,
      filterBuilder: new queries.PatrolFilterBuilder(),
    }),
  };
}

/**
 * Builds the patrol monitoring module.
 *
 * @param {object} [overrides] replacements used by tests
 * @param {object} [overrides.repositories] { patrols, rangers, parks, zones, routes }
 * @param {object} [overrides.gpsService] any GpsTrackingService
 * @param {object} [overrides.coverageStrategy] any CoverageStrategy
 * @param {object[]} [overrides.underPatrolledRules] rule objects with check()
 * @param {() => Date} [overrides.clock]
 * @param {object} [overrides.logger]
 * @param {object} [overrides.env] environment flags (defaults to process.env)
 * @returns {{ services: object, mount: (app: object, guards?: object) => void }}
 */
function createPatrolModule(overrides = {}) {
  const logger = overrides.logger ?? createConsoleLogger('patrol');
  const clock = overrides.clock ?? (() => new Date());
  const repositories = overrides.repositories ?? createMongoRepositories();
  const gpsService =
    overrides.gpsService ?? createSimulatedGps(repositories, clock, overrides.env ?? process.env);
  const calc = createCalculators(
    overrides.coverageStrategy ?? createCoverageStrategy(config),
    overrides.underPatrolledRules,
  );
  const services = createServices({ repositories, gpsService, clock, logger, calc });

  return {
    services,
    /** Registers the routes on an Express app. */
    mount(app, guards = {}) {
      const routers = createPatrolRouters({
        controller: createPatrolController(services),
        errorHandler: createPatrolErrorHandler(logger),
        guards,
      });
      app.use('/api/patrols', routers.patrols);
      app.use('/api/parks', routers.parks);
      app.use('/api/rangers', routers.rangers);
    },
  };
}

/**
 * A stand-alone Express app containing only the patrol routes. Used by the
 * API tests: `createPatrolApp({ repositories, gpsService })`.
 * @param {object} [overrides] see createPatrolModule
 * @returns {import('express').Express}
 */
function createPatrolApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  createPatrolModule(overrides).mount(app);
  return app;
}

/**
 * Adds patrol monitoring to the main application, reusing the access
 * control the application already has for its other modules.
 * @param {import('express').Express} app
 */
function mountPatrolMonitoring(app) {
  const { protect, authorize } = require('./middleware/auth.middleware');
  const { ROLES } = require('./constants/roles');
  const viewers = [ROLES.PARK_MANAGER, ROLES.ADMIN, ROLES.RANGER_SUPERVISOR];
  const evaluators = [ROLES.PARK_MANAGER, ROLES.ADMIN];

  createPatrolModule().mount(app, {
    view: [protect, authorize(...viewers)],
    evaluate: [protect, authorize(...evaluators)],
  });
}

module.exports = { createPatrolModule, createPatrolApp, mountPatrolMonitoring };
