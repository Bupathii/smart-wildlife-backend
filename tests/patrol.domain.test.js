'use strict';

/**
 * Unit tests for the pure parts of patrol monitoring: geometry, domain
 * classes, coverage strategies and the calculators.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config/patrol.config');
const geo = require('../src/utils/geo');
const { LocationSource, PatrolStatus } = require('../src/constants/patrolEnums');
const {
  LocationPoint,
  Zone,
  PatrolCoverage,
  PatrolEvaluation,
} = require('../src/models/patrolDomain');
const CoverageStrategy = require('../src/strategies/CoverageStrategy');
const {
  createCoverageStrategy,
  ZoneProximityCoverageStrategy,
  TimeWeightedCoverageStrategy,
} = require('../src/strategies');
const {
  PatrolProgressCalculator,
  ZoneCoverageAnalyzer,
  LowCoverageRule,
  NotRecentlyPatrolledRule,
  UnderPatrolledZoneDetector,
  PatrolTimelineBuilder,
} = require('../src/services/patrolCalculators');
const { NOW, hoursAgo } = require('./patrol.helpers');

const KM_PER_DEGREE_LATITUDE = 111.19;
const point = (latitude, longitude, timestamp = NOW) => ({ latitude, longitude, timestamp });

const SQUARE = new Zone({
  zoneId: 'ZN-T1',
  name: 'Test Square',
  boundary: [point(0, 0), point(0, 1), point(1, 1), point(1, 0)],
});
const EMPTY_ZONE = new Zone({
  zoneId: 'ZN-T2',
  name: 'No Waypoints',
  boundary: [point(5, 5), point(5, 6), point(6, 6), point(6, 5)],
});
// Four waypoints inside SQUARE, roughly 22 km apart.
const ROUTE = {
  routeId: 'RT-T1',
  zoneIds: ['ZN-T1'],
  waypoints: [point(0.2, 0.2), point(0.4, 0.4), point(0.6, 0.6), point(0.8, 0.8)],
};
const patrolWithTrack = (track) => ({
  patrolId: 'PT-T1',
  status: PatrolStatus.ACTIVE,
  startTime: hoursAgo(2),
  endTime: null,
  track,
});

/* ----------------------------- LocationPoint ----------------------------- */

test('T-20 LocationPoint.calculateDistance returns the Haversine distance in km', () => {
  const origin = new LocationPoint(point(6, 81));
  const oneDegreeNorth = new LocationPoint(point(7, 81));

  assert.ok(Math.abs(origin.calculateDistance(oneDegreeNorth) - KM_PER_DEGREE_LATITUDE) < 0.1);
  assert.equal(origin.calculateDistance(origin), 0);
});

test('T-20 LocationPoint.isValid accepts real coordinates and rejects impossible ones', () => {
  assert.equal(new LocationPoint(point(6.37, 81.52)).isValid(), true);
  assert.equal(new LocationPoint(point(90, 180)).isValid(), true);
  assert.equal(new LocationPoint(point(90.1, 81)).isValid(), false);
  assert.equal(new LocationPoint(point(-91, 81)).isValid(), false);
  assert.equal(new LocationPoint(point(6, 180.5)).isValid(), false);
  assert.equal(new LocationPoint(point(Number.NaN, 81)).isValid(), false);
  assert.equal(new LocationPoint(point('6.3', 81)).isValid(), false);
});

test('LocationPoint.from converts stored data and keeps the value immutable', () => {
  const stored = { latitude: 6.3, longitude: 81.4, timestamp: '2026-05-18T09:00:00.000Z' };
  const created = LocationPoint.from(stored);

  assert.equal(LocationPoint.from(null), null);
  assert.equal(LocationPoint.from(created), created);
  assert.equal(created.source, LocationSource.GPS);
  assert.deepEqual(created.toJSON(), {
    latitude: 6.3,
    longitude: 81.4,
    timestamp: new Date('2026-05-18T09:00:00.000Z'),
    source: LocationSource.GPS,
  });
  assert.equal(new LocationPoint({ latitude: 1, longitude: 2 }).timestamp, null);
  assert.throws(() => {
    created.latitude = 0;
  }, TypeError);
});

/* --------------------------------- Zone ---------------------------------- */

test('T-21 Zone.contains handles inside, outside and boundary points', () => {
  assert.equal(SQUARE.contains(point(0.5, 0.5)), true, 'centre is inside');
  assert.equal(SQUARE.contains(point(1.5, 0.5)), false, 'north of the zone');
  assert.equal(SQUARE.contains(point(0.5, -0.1)), false, 'west of the zone');
  assert.equal(SQUARE.contains(point(0.5, 0)), true, 'on an edge counts as inside');
  assert.equal(SQUARE.contains(point(1, 1)), true, 'on a corner counts as inside');
  assert.equal(SQUARE.contains(point(1.0001, 1)), false, 'just outside the corner');
});

/* --------------------------------- geo ----------------------------------- */

test('geo helpers measure and walk along a route', () => {
  const line = [point(0, 0), point(1, 0), point(2, 0)];
  const length = geo.routeLengthKm(line);

  assert.ok(Math.abs(length - 2 * KM_PER_DEGREE_LATITUDE) < 0.2);
  assert.equal(geo.routeLengthKm([point(0, 0)]), 0);
  assert.equal(geo.routeLengthKm(undefined), 0);
  assert.deepEqual(geo.pointAlongRoute(line, -5), { latitude: 0, longitude: 0 });
  assert.deepEqual(geo.pointAlongRoute(line, length * 2), { latitude: 2, longitude: 0 });
  assert.ok(Math.abs(geo.pointAlongRoute(line, length / 2).latitude - 1) < 1e-6);
  assert.ok(Math.abs(geo.distanceAlongRouteKm(line, point(1.5, 0.01)) - length * 0.75) < 0.1);
  assert.equal(geo.roundTo(12.345, 1), 12.3);
  assert.equal(geo.roundTo(12.5), 13);
});

test('geo helpers cope with repeated points (zero-length segments)', () => {
  const stalled = [point(1, 1), point(1, 1), point(2, 1)];

  assert.deepEqual(geo.pointAlongRoute(stalled, 0), { latitude: 1, longitude: 1 });
  assert.equal(geo.distanceAlongRouteKm(stalled, point(1, 1)), 0);
});

/* ----------------------------- PatrolCoverage ---------------------------- */

test('PatrolCoverage averages zones and lists those below a threshold', () => {
  const coverage = new PatrolCoverage({
    coverageId: 'COV-1',
    calculatedAt: NOW,
    zoneCoverage: [
      { zoneId: 'A', percentage: 80 },
      { zoneId: 'B', percentage: 40 },
      { zoneId: 'C', percentage: 15 },
    ],
  });

  assert.equal(coverage.calculateCoverage(), 45);
  assert.equal(coverage.percentage, 45);
  assert.deepEqual(coverage.identifyUnderPatrolledZones(40), [{ zoneId: 'C', percentage: 15 }]);
  assert.equal(coverage.toJSON().coverageId, 'COV-1');
  assert.equal(
    new PatrolCoverage({ coverageId: 'COV-2', calculatedAt: NOW }).calculateCoverage(),
    0,
  );
});

/* ---------------------------- PatrolEvaluation --------------------------- */

test('PatrolEvaluation.validate reports each broken rule by field', () => {
  const build = (values) =>
    new PatrolEvaluation({
      evaluationId: 'EV-1',
      evaluatedBy: 'PM-001',
      evaluatedAt: NOW,
      ...values,
    });

  assert.deepEqual(build({ rating: 5 }).validate(), {});
  assert.deepEqual(build({ rating: 3, notes: '  trimmed  ' }).toJSON().notes, 'trimmed');
  assert.equal(build({ rating: undefined }).validate().rating, 'Rating is required');
  assert.equal(build({ rating: 2.5 }).validate().rating, 'Rating must be a whole number');
  assert.equal(build({ rating: 6 }).validate().rating, 'Rating must be between 1 and 5');
  assert.equal(
    build({ rating: 1, notes: '   ' }).validate().notes,
    'Notes are required when the rating is 2 or lower',
  );
  assert.equal(build({ rating: 4, notes: 42 }).validate().notes, 'Notes must be text');
  assert.equal(
    build({ rating: 4, evaluatedBy: ' ' }).validate().evaluatedBy,
    'Evaluator is required',
  );
});

/* -------------------------- Coverage strategies -------------------------- */

const strategyOptions = {
  waypointRadiusKm: config.WAYPOINT_RADIUS_KM,
  windowHours: config.UNDER_PATROLLED_WINDOW_HOURS,
};
const STRATEGIES = [
  new ZoneProximityCoverageStrategy(strategyOptions),
  new TimeWeightedCoverageStrategy(strategyOptions),
];

for (const strategy of STRATEGIES) {
  const name = strategy.constructor.name;

  test(`T-23 ${name} honours the shared CoverageStrategy contract (LSP)`, () => {
    const zones = [SQUARE, EMPTY_ZONE];
    const calculate = (track) =>
      strategy.calculateZoneCoverage({
        zones,
        routes: [ROUTE],
        patrols: [patrolWithTrack(track)],
        now: NOW,
      });

    const nothingVisited = calculate([]);
    const allVisitedNow = calculate(ROUTE.waypoints);
    const halfVisitedNow = calculate(ROUTE.waypoints.slice(0, 2));

    assert.deepEqual(nothingVisited, [
      { zoneId: 'ZN-T1', percentage: 0 },
      { zoneId: 'ZN-T2', percentage: 0 },
    ]);
    assert.equal(allVisitedNow[0].percentage, 100);
    assert.equal(halfVisitedNow[0].percentage, 50);
    assert.equal(allVisitedNow[1].percentage, 0, 'a zone without waypoints is never covered');
    assert.equal(allVisitedNow.length, zones.length);
  });
}

test('T-23 the two strategies differ only in how they value old visits (OCP)', () => {
  const dayOld = ROUTE.waypoints.map((waypoint) => ({ ...waypoint, timestamp: hoursAgo(24) }));
  const expired = ROUTE.waypoints.map((waypoint) => ({ ...waypoint, timestamp: hoursAgo(60) }));
  const input = (track) => ({
    zones: [SQUARE],
    routes: [ROUTE],
    patrols: [patrolWithTrack(track)],
    now: NOW,
  });
  const [proximity, timeWeighted] = STRATEGIES;

  assert.equal(proximity.calculateZoneCoverage(input(dayOld))[0].percentage, 100);
  assert.equal(timeWeighted.calculateZoneCoverage(input(dayOld))[0].percentage, 50);
  assert.equal(proximity.calculateZoneCoverage(input(expired))[0].percentage, 100);
  assert.equal(timeWeighted.calculateZoneCoverage(input(expired))[0].percentage, 0);
});

test('a waypoint counts only when a track point is within the 200 m radius', () => {
  const [proximity] = STRATEGIES;
  const near = point(0.2 + 0.0015, 0.2); // about 167 m from the first waypoint
  const far = point(0.2 + 0.0025, 0.2); // about 278 m from the first waypoint
  const coverage = (track) =>
    proximity.calculateZoneCoverage({
      zones: [SQUARE],
      routes: [ROUTE],
      patrols: [patrolWithTrack(track)],
      now: NOW,
    })[0].percentage;

  assert.equal(coverage([near]), 25);
  assert.equal(coverage([far]), 0);
});

test('the strategy factory builds the configured strategy and rejects unknown names', () => {
  assert.ok(createCoverageStrategy(config) instanceof ZoneProximityCoverageStrategy);
  assert.ok(
    createCoverageStrategy({ ...config, COVERAGE_STRATEGY: 'TIME_WEIGHTED' }) instanceof
      TimeWeightedCoverageStrategy,
  );
  assert.throws(
    () => createCoverageStrategy({ ...config, COVERAGE_STRATEGY: 'GUESSWORK' }),
    /Unknown coverage strategy "GUESSWORK"/,
  );
  assert.throws(
    () => new CoverageStrategy(strategyOptions).scoreWaypoint(null, NOW),
    /not implemented/,
  );
});

/* ------------------------ PatrolProgressCalculator ----------------------- */

test('T-02 progress is 0% at the start, 100% at the last waypoint and never above 100%', () => {
  const calculator = new PatrolProgressCalculator();
  const [start, second, , last] = ROUTE.waypoints;
  const beyondTheEnd = point(0.9, 0.9);

  assert.equal(calculator.calculate(ROUTE, []).progressPercentage, 0);
  assert.equal(calculator.calculate(ROUTE, [start]).progressPercentage, 0);
  assert.equal(calculator.calculate(ROUTE, [start, second]).progressPercentage, 33);
  assert.equal(calculator.calculate(ROUTE, [start, last]).progressPercentage, 100);
  assert.equal(calculator.calculate(ROUTE, [last, beyondTheEnd]).progressPercentage, 100);
  assert.equal(
    calculator.calculate(ROUTE, [last]).distanceCoveredKm,
    geo.roundTo(geo.routeLengthKm(ROUTE.waypoints), 2),
  );
});

test('T-02 progress keeps the furthest point reached and ignores a route with no length', () => {
  const calculator = new PatrolProgressCalculator();
  const [start, second, third] = ROUTE.waypoints;

  // The ranger walked to the third waypoint and then turned back.
  assert.equal(calculator.calculate(ROUTE, [start, third, second]).progressPercentage, 67);
  assert.deepEqual(calculator.calculate({ waypoints: [start] }, [start]), {
    progressPercentage: 0,
    distanceCoveredKm: 0,
  });
});

/* -------------------------- Under-patrolled zones ------------------------ */

const zoneStat = (percentage, lastPatrolledAt) => ({
  zoneId: 'ZN-T1',
  name: 'Test Square',
  percentage,
  lastPatrolledAt,
});
const defaultRules = () => [
  new LowCoverageRule({ thresholdPercent: config.COVERAGE_THRESHOLD_PERCENT }),
  new NotRecentlyPatrolledRule({ windowHours: config.UNDER_PATROLLED_WINDOW_HOURS }),
];

test('T-03 a zone at exactly 40% is acceptable, 39.9% is under-patrolled', () => {
  const detector = new UnderPatrolledZoneDetector({ rules: defaultRules() });

  assert.deepEqual(detector.detect([zoneStat(40, hoursAgo(1))], NOW), []);
  assert.deepEqual(detector.detect([zoneStat(39.9, hoursAgo(1))], NOW), [
    { ...zoneStat(39.9, hoursAgo(1)), reasons: ['Coverage is below 40%'] },
  ]);
});

test('T-04 a zone last patrolled 48 h ago is under-patrolled, 47 h ago is not', () => {
  const detector = new UnderPatrolledZoneDetector({ rules: defaultRules() });
  const reason = 'Not patrolled in the last 48 hours';

  assert.deepEqual(detector.detect([zoneStat(90, hoursAgo(47))], NOW), []);
  assert.deepEqual(detector.detect([zoneStat(90, hoursAgo(48))], NOW)[0].reasons, [reason]);
  assert.deepEqual(detector.detect([zoneStat(90, hoursAgo(72))], NOW)[0].reasons, [reason]);
});

test('T-05 a zone with no patrol records has 0% coverage and is under-patrolled', () => {
  const analyzer = new ZoneCoverageAnalyzer({ coverageStrategy: STRATEGIES[0] });
  const detector = new UnderPatrolledZoneDetector({ rules: defaultRules() });

  const { coverage, zoneStats } = analyzer.analyze({
    zones: [SQUARE],
    routes: [ROUTE],
    patrols: [],
    now: NOW,
  });

  assert.deepEqual(zoneStats, [zoneStat(0, null)]);
  assert.equal(coverage.percentage, 0);
  assert.equal(coverage.coverageId, `COV-${NOW.getTime()}`);
  assert.deepEqual(detector.detect(zoneStats, NOW)[0].reasons, [
    'Coverage is below 40%',
    'Not patrolled in the last 48 hours',
  ]);
});

test('the analyzer reports the newest visit to each zone', () => {
  const analyzer = new ZoneCoverageAnalyzer({ coverageStrategy: STRATEGIES[0] });
  const track = [
    { ...ROUTE.waypoints[0], timestamp: hoursAgo(5) },
    { ...ROUTE.waypoints[1], timestamp: hoursAgo(3) },
    { latitude: 9, longitude: 9, timestamp: hoursAgo(1) }, // outside every zone
  ];

  const { coverage, zoneStats } = analyzer.analyze({
    zones: [SQUARE, EMPTY_ZONE],
    routes: [ROUTE],
    patrols: [patrolWithTrack(track)],
    now: NOW,
  });

  assert.deepEqual(zoneStats[0].lastPatrolledAt, hoursAgo(3));
  assert.equal(zoneStats[0].percentage, 50);
  assert.equal(zoneStats[1].lastPatrolledAt, null);
  assert.equal(coverage.percentage, 25);
});

test('T-24 a new under-patrolled rule works without changing the detector (OCP)', () => {
  /** A rule invented for this test: flag zones nobody has named properly. */
  class UnnamedZoneRule {
    check(stat) {
      return stat.name.startsWith('Test') ? 'Zone still has a placeholder name' : null;
    }
  }
  const detector = new UnderPatrolledZoneDetector({
    rules: [...defaultRules(), new UnnamedZoneRule()],
  });

  const flagged = detector.detect([zoneStat(95, hoursAgo(1))], NOW);

  assert.equal(flagged.length, 1);
  assert.deepEqual(flagged[0].reasons, ['Zone still has a placeholder name']);
});

/* ------------------------------- Timeline -------------------------------- */

test('the timeline lists the start, each waypoint reached and the completion in order', () => {
  const builder = new PatrolTimelineBuilder({ waypointRadiusKm: config.WAYPOINT_RADIUS_KM });
  const track = [
    { ...ROUTE.waypoints[0], timestamp: hoursAgo(3.5) },
    { ...ROUTE.waypoints[1], timestamp: hoursAgo(3) },
  ];
  const completed = {
    ...patrolWithTrack(track),
    status: PatrolStatus.COMPLETED,
    startTime: hoursAgo(4),
    endTime: hoursAgo(2),
  };

  const timeline = builder.build(completed, ROUTE);
  const stillActive = builder.build({ ...completed, status: PatrolStatus.ACTIVE }, ROUTE);

  assert.deepEqual(
    timeline.map((event) => event.label),
    ['Patrol started', 'Waypoint 1 reached', 'Waypoint 2 reached', 'Patrol completed'],
  );
  assert.deepEqual(timeline.at(-1), {
    type: 'COMPLETED',
    label: 'Patrol completed',
    timestamp: hoursAgo(2),
  });
  assert.equal(stillActive.at(-1).type, 'WAYPOINT');
});

test('configuration values are frozen so thresholds cannot be changed at runtime', () => {
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.EVALUATION), true);
  assert.equal(config.COVERAGE_THRESHOLD_PERCENT, 40);
  assert.equal(config.RECENT_COMPLETED_HOURS, 24);
});
