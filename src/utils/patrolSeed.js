'use strict';

/**
 * Sample data for "Monitor and Evaluate Ranger Patrol Activities":
 * Yala National Park with 4 zones, 4 routes, 6 rangers and 8 patrols.
 *
 * Run with:  npm run seed:patrols
 * Flags:     SEED_NO_ACTIVE=true  → seed without any patrol in the field
 *            (demonstrates the "No active patrols" screen, EX2)
 *
 * Only the Park / Ranger / Patrol collections for this park are replaced.
 * Users and conflict reports are never touched.
 */

/* eslint-disable no-magic-numbers -- coordinates and sample values are data, not logic */

const { LocationSource, PatrolStatus, TrackingStatus } = require('../constants/patrolEnums');
const config = require('../config/patrol.config');
const { pointAlongRoute, routeLengthKm, roundTo } = require('./geo');
const { Zone } = require('../models/patrolDomain');
const { createCoverageStrategy } = require('../strategies');
const { PatrolProgressCalculator, ZoneCoverageAnalyzer } = require('../services/patrolCalculators');

const PARK_ID = 'PK-YALA';
const DEMO_MANAGER_ID = 'PM-001';
const HOUR_MS = 3_600_000;
const TRACK_SPACING_KM = 0.15;
const SKIP_OFFSET_DEGREES = 0.006;
const HEADQUARTERS = { latitude: 6.28, longitude: 81.404 };

const point = (latitude, longitude) => ({ latitude, longitude });
const rectangle = (south, west, north, east) => [
  point(south, west),
  point(south, east),
  point(north, east),
  point(north, west),
];

const ZONES = [
  { zoneId: 'ZN-001', name: 'Block 1 North', boundary: rectangle(6.4, 81.38, 6.46, 81.5) },
  { zoneId: 'ZN-002', name: 'Block 1 South', boundary: rectangle(6.34, 81.38, 6.4, 81.5) },
  { zoneId: 'ZN-003', name: 'Palatupana Coast', boundary: rectangle(6.27, 81.36, 6.34, 81.46) },
  { zoneId: 'ZN-004', name: 'Menik River Buffer', boundary: rectangle(6.46, 81.4, 6.52, 81.54) },
];

const ROUTES = [
  {
    routeId: 'RT-001',
    name: 'Block 1 North Circuit',
    description: 'Northern grassland and waterhole circuit.',
    zoneIds: ['ZN-001'],
    waypoints: [
      point(6.41, 81.395),
      point(6.42, 81.41),
      point(6.432, 81.425),
      point(6.44, 81.44),
      point(6.448, 81.455),
      point(6.452, 81.475),
    ],
  },
  {
    routeId: 'RT-002',
    name: 'Block 1 South Track',
    description: 'Scrub forest track along the southern tanks.',
    zoneIds: ['ZN-002'],
    waypoints: [
      point(6.35, 81.39),
      point(6.356, 81.405),
      point(6.364, 81.42),
      point(6.372, 81.433),
      point(6.38, 81.447),
      point(6.388, 81.46),
      point(6.394, 81.472),
    ],
  },
  {
    routeId: 'RT-003',
    name: 'Palatupana Coastal Patrol',
    description: 'Entrance gate to the coastal lagoons.',
    zoneIds: ['ZN-003'],
    waypoints: [
      point(6.285, 81.375),
      point(6.292, 81.388),
      point(6.3, 81.4),
      point(6.308, 81.412),
      point(6.317, 81.425),
      point(6.326, 81.437),
      point(6.334, 81.45),
    ],
  },
  {
    routeId: 'RT-004',
    name: 'Menik River Buffer Line',
    description: 'Boundary line along the Menik Ganga buffer.',
    zoneIds: ['ZN-004'],
    waypoints: [
      point(6.47, 81.415),
      point(6.476, 81.432),
      point(6.483, 81.45),
      point(6.49, 81.468),
      point(6.497, 81.485),
      point(6.505, 81.503),
      point(6.512, 81.52),
    ],
  },
].map((route) => ({ ...route, routeLength: roundTo(routeLengthKm(route.waypoints), 2) }));

const RANGERS = [
  { rangerId: 'RN-001', name: 'Thilina Perera', rank: 'Senior Ranger', phoneNumber: '0771234501' },
  { rangerId: 'RN-002', name: 'Kamal Fernando', rank: 'Ranger', phoneNumber: '0771234502' },
  { rangerId: 'RN-003', name: 'Nadeesh Silva', rank: 'Ranger', phoneNumber: '0771234503' },
  { rangerId: 'RN-004', name: 'Sivakumar Rajan', rank: 'Senior Ranger', phoneNumber: '0771234504' },
  { rangerId: 'RN-005', name: 'Saman Iddamalgoda', rank: 'Ranger', phoneNumber: '0771234505' },
  {
    rangerId: 'RN-006',
    name: 'Priya Nadarajah',
    rank: 'Trainee Ranger',
    phoneNumber: '0771234506',
  },
];

/**
 * Patrol plans. Hours are relative to "now" (negative = in the past).
 * `fraction` is how much of the route the track covers; `skip` lists
 * waypoint indexes the ranger passed too far from (lower coverage).
 */
const IN_PROGRESS_PLANS = [
  {
    id: 'PT-001',
    status: PatrolStatus.ACTIVE,
    rangers: ['RN-001'],
    route: 'RT-001',
    start: -2,
    end: 2,
    fraction: 0.55,
  },
  {
    id: 'PT-002',
    status: PatrolStatus.ACTIVE,
    rangers: ['RN-002', 'RN-006'],
    route: 'RT-002',
    start: -1,
    end: 3,
    fraction: 0.3,
  },
  // RN-003 has no GPS signal: the track stopped 25 minutes ago (EX1).
  {
    id: 'PT-003',
    status: PatrolStatus.ACTIVE,
    rangers: ['RN-003'],
    route: 'RT-003',
    start: -1.5,
    end: 2.5,
    fraction: 0.25,
    lastFix: -25 / 60,
  },
  {
    id: 'PT-004',
    status: PatrolStatus.DELAYED,
    rangers: ['RN-005'],
    route: 'RT-001',
    start: -3,
    end: 1,
    fraction: 0.2,
  },
];

const COMPLETED_PLANS = [
  {
    id: 'PT-005',
    rangers: ['RN-004'],
    route: 'RT-001',
    start: -9,
    end: -5,
    rating: 4,
    notes: 'Route fully covered and all checkpoints reported on time.',
  },
  { id: 'PT-006', rangers: ['RN-004'], route: 'RT-002', start: -34, end: -30, skip: [2, 5] },
  // The only patrol in the Menik River Buffer is 4 days old → under-patrolled zone.
  {
    id: 'PT-007',
    rangers: ['RN-005'],
    route: 'RT-004',
    start: -100,
    end: -96,
    skip: [3],
    rating: 2,
    notes: 'River crossing checkpoint was skipped; follow-up patrol needed.',
    source: LocationSource.SYNCHRONIZED,
  },
  { id: 'PT-008', rangers: ['RN-006', 'RN-002'], route: 'RT-003', start: -148, end: -144 },
].map((plan) => ({ ...plan, status: PatrolStatus.COMPLETED, fraction: 1 }));

const hoursFrom = (now, hours) => new Date(now.getTime() + hours * HOUR_MS);

/** The path actually walked: skipped waypoints are replaced by a detour. */
function walkedPath(waypoints, skip = []) {
  return waypoints.map((waypoint, index) =>
    skip.includes(index)
      ? point(waypoint.latitude + SKIP_OFFSET_DEGREES, waypoint.longitude)
      : waypoint,
  );
}

/** Evenly spaced, time-stamped track points along the walked path. */
function buildTrack(route, plan, now) {
  const path = walkedPath(route.waypoints, plan.skip);
  const walkedKm = routeLengthKm(path) * plan.fraction;
  const steps = Math.max(1, Math.ceil(walkedKm / TRACK_SPACING_KM));
  const startMs = hoursFrom(now, plan.start).getTime();
  const lastFixHours = plan.lastFix ?? Math.min(plan.end, 0);
  const durationMs = hoursFrom(now, lastFixHours).getTime() - startMs;

  return Array.from({ length: steps + 1 }, (_, step) => ({
    ...pointAlongRoute(path, (walkedKm * step) / steps),
    timestamp: new Date(startMs + (durationMs * step) / steps),
    source: plan.source ?? LocationSource.GPS,
  }));
}

function buildEvaluation(plan, now) {
  if (!plan.rating) return null;
  return {
    evaluationId: `EV-${plan.id}`,
    rating: plan.rating,
    notes: plan.notes,
    evaluatedBy: DEMO_MANAGER_ID,
    evaluatedAt: hoursFrom(now, plan.end + 1),
  };
}

/** Builds one patrol record, including its stored progress and coverage. */
function buildPatrol(plan, now, calculators) {
  const route = ROUTES.find((candidate) => candidate.routeId === plan.route);
  const track = buildTrack(route, plan, now);
  const endTime = hoursFrom(now, plan.end);
  const patrol = { rangerIds: plan.rangers, track, status: plan.status, endTime };
  const { coverage } = calculators.analyzer.analyze({
    zones: calculators.zones.filter((zone) => route.zoneIds.includes(zone.zoneId)),
    routes: [route],
    patrols: [patrol],
    now: plan.status === PatrolStatus.COMPLETED ? endTime : now,
  });

  return {
    patrolId: plan.id,
    parkId: PARK_ID,
    rangerIds: plan.rangers,
    routeId: route.routeId,
    startTime: hoursFrom(now, plan.start),
    endTime,
    status: plan.status,
    progressPercentage: calculators.progress.calculate(route, track).progressPercentage,
    coveragePercentage: coverage.percentage,
    track,
    coverage: coverage.toJSON(),
    evaluation: buildEvaluation(plan, now),
  };
}

/** Each ranger's stored tracking state, taken from their in-progress patrol. */
function buildRanger(ranger, patrols, now) {
  const current = patrols.find(
    (patrol) =>
      patrol.status !== PatrolStatus.COMPLETED && patrol.rangerIds.includes(ranger.rangerId),
  );
  const lastPoint = current?.track.at(-1);
  const offline = !current || config.SIMULATED_GPS.OFFLINE_RANGER_IDS.includes(ranger.rangerId);

  return {
    ...ranger,
    parkId: PARK_ID,
    trackingStatus: offline ? TrackingStatus.OFFLINE : TrackingStatus.ONLINE,
    lastSyncTime: lastPoint?.timestamp ?? hoursFrom(now, -12),
    lastKnownLocation: lastPoint ?? {
      ...HEADQUARTERS,
      timestamp: hoursFrom(now, -12),
      source: LocationSource.SYNCHRONIZED,
    },
  };
}

/**
 * Builds the complete sample data set relative to `now`.
 * @param {{ now?: Date, includeActive?: boolean }} [options]
 * @returns {{ park: object, rangers: object[], patrols: object[] }}
 */
function buildSeedData({ now = new Date(), includeActive = true } = {}) {
  const calculators = {
    zones: ZONES.map((zone) => new Zone(zone)),
    progress: new PatrolProgressCalculator(),
    analyzer: new ZoneCoverageAnalyzer({ coverageStrategy: createCoverageStrategy(config) }),
  };
  const plans = includeActive ? [...IN_PROGRESS_PLANS, ...COMPLETED_PLANS] : COMPLETED_PLANS;
  const patrols = plans.map((plan) => buildPatrol(plan, now, calculators));

  return {
    park: {
      parkId: PARK_ID,
      name: 'Yala National Park',
      location: point(6.39, 81.44),
      terrainType: 'Dry monsoon forest, grassland and coastal lagoons',
      zones: ZONES,
      routes: ROUTES,
    },
    rangers: RANGERS.map((ranger) => buildRanger(ranger, patrols, now)),
    patrols,
  };
}

/** Replaces this park's sample data in the configured database. */
async function runSeed() {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const { createConsoleLogger } = require('./logger');
  const Park = require('../models/Park');
  const Ranger = require('../models/Ranger');
  const Patrol = require('../models/Patrol');
  const logger = createConsoleLogger('patrol-seed');

  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set in .env');
  const data = buildSeedData({ includeActive: process.env.SEED_NO_ACTIVE !== 'true' });

  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([Park, Ranger, Patrol].map((model) => model.deleteMany({ parkId: PARK_ID })));
  await Park.create(data.park);
  await Ranger.insertMany(data.rangers);
  await Patrol.insertMany(data.patrols);
  await mongoose.disconnect();

  logger.info(
    `Seeded ${data.rangers.length} rangers and ${data.patrols.length} patrols for`,
    PARK_ID,
  );
}

if (require.main === module) {
  runSeed().catch((error) => {
    require('./logger').createConsoleLogger('patrol-seed').error('Seeding failed', error);
    process.exitCode = 1;
  });
}

module.exports = { buildSeedData, PARK_ID, DEMO_MANAGER_ID };
