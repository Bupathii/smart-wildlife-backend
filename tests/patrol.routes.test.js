'use strict';

/**
 * Tests for patrol route management (create, edit, delete): the service
 * rules, the repository writes and the HTTP endpoints.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { createPatrolApp, createPatrolModule } = require('../src/patrol.container');
const contracts = require('../src/repositories/patrolContracts');
const { RouteRepository } = require('../src/repositories/ParkRepositories');
const { ConflictError, NotFoundError, ValidationError } = require('../src/errors/patrolErrors');
const { RouteValidator } = require('../src/services/patrolRoute.service');
const { LocationSource } = require('../src/constants/patrolEnums');
const config = require('../src/config/patrol.config');
const { routeLengthKm, roundTo } = require('../src/utils/geo');
const {
  NOW,
  createRepositories,
  createSilentLogger,
  MockGpsTrackingService,
} = require('./patrol.helpers');

const PARK_ID = 'PK-YALA';
const point = (latitude, longitude) => ({ latitude, longitude });

// Three points inside "Block 1 North" (ZN-001), then one inside "Menik River Buffer" (ZN-004).
const NORTH_WAYPOINTS = [point(6.41, 81.4), point(6.42, 81.42), point(6.43, 81.44)];
const CROSS_ZONE_WAYPOINTS = [...NORTH_WAYPOINTS, point(6.47, 81.45)];
const OUTSIDE_PARK = point(7.5, 80.5);

const routeInput = (overrides = {}) => ({
  name: 'Northern Waterhole Loop',
  description: 'Checks the three northern waterholes.',
  waypoints: NORTH_WAYPOINTS,
  ...overrides,
});

/** The route service on in-memory repositories. */
function createRouteService(repositoryOptions) {
  const repositories = createRepositories(repositoryOptions);
  const { services } = createPatrolModule({
    repositories,
    gpsService: new MockGpsTrackingService(),
    clock: () => NOW,
    logger: createSilentLogger(),
  });
  return { routeService: services.routeService, services, repositories };
}

/** Runs the action and returns the error it raised (fails if none). */
async function errorFrom(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return assert.fail('expected the action to be rejected');
}

/* ------------------------------- Listing --------------------------------- */

test('routes are listed with how many patrols use them', async () => {
  const { routeService } = createRouteService();

  const routes = await routeService.listRoutes(PARK_ID);
  const usage = Object.fromEntries(
    routes.map((route) => [route.routeId, [route.patrolCount, route.hasActivePatrol]]),
  );

  assert.equal(routes.length, 4);
  assert.deepEqual(usage, {
    'RT-001': [3, true], // PT-001, PT-004 in the field + PT-005 completed
    'RT-002': [2, true],
    'RT-003': [2, true],
    'RT-004': [1, false], // only the completed PT-007
  });
  await assert.rejects(() => routeService.listRoutes('PK-NOWHERE'), NotFoundError);
});

/* ------------------------------- Creating -------------------------------- */

test('a new route gets the next id, its length and its zones worked out', async () => {
  const { routeService, repositories } = createRouteService();

  const created = await routeService.createRoute(
    PARK_ID,
    routeInput({ name: '  Northern Waterhole Loop  ', waypoints: CROSS_ZONE_WAYPOINTS }),
  );
  const stored = await repositories.routes.findByRouteId('RT-005');

  assert.equal(created.routeId, 'RT-005');
  assert.equal(created.name, 'Northern Waterhole Loop', 'name is trimmed');
  assert.equal(created.routeLength, roundTo(routeLengthKm(CROSS_ZONE_WAYPOINTS), 2));
  assert.deepEqual(created.zoneIds, ['ZN-001', 'ZN-004']);
  assert.equal(created.patrolCount, 0);
  assert.equal(created.hasActivePatrol, false);
  assert.deepEqual(created.waypoints[0], {
    latitude: 6.41,
    longitude: 81.4,
    timestamp: null,
    source: LocationSource.MANUAL,
  });
  assert.equal(stored.name, 'Northern Waterhole Loop');
  assert.equal(stored.waypoints.length, 4);
  assert.equal((await routeService.listRoutes(PARK_ID)).length, 5);
});

test('route ids keep counting upwards and the description is optional', async () => {
  const { routeService } = createRouteService();

  const first = await routeService.createRoute(PARK_ID, routeInput({ description: undefined }));
  const second = await routeService.createRoute(PARK_ID, routeInput({ name: 'Second Loop' }));

  assert.equal(first.routeId, 'RT-005');
  assert.equal(first.description, '');
  assert.equal(second.routeId, 'RT-006');
});

test('a new route appears on the map data used by the dashboard', async () => {
  const { routeService, services } = createRouteService();

  await routeService.createRoute(PARK_ID, routeInput());
  const map = await services.referenceService.getParkMap(PARK_ID);

  assert.equal(map.routes.length, 5);
  assert.equal(map.routes.at(-1).name, 'Northern Waterhole Loop');
});

test('a route needs a name that is present, short enough and not already used', async () => {
  const { routeService } = createRouteService();
  const nameError = async (name) =>
    (await errorFrom(() => routeService.createRoute(PARK_ID, routeInput({ name })))).fields.name;

  assert.equal(await nameError(''), 'Route name is required');
  assert.equal(await nameError('   '), 'Route name is required');
  assert.equal(await nameError(undefined), 'Route name is required');
  assert.equal(await nameError(42), 'Route name is required');
  assert.equal(await nameError('x'.repeat(81)), 'Route name must be 80 characters or fewer');
  assert.equal(await nameError('block 1 north circuit'), 'Another route already has this name');
  assert.equal(
    (await routeService.createRoute(PARK_ID, routeInput({ name: 'x'.repeat(80) }))).name.length,
    80,
  );
});

test('a route needs between 2 and 50 valid waypoints inside the park zones', async () => {
  const { routeService } = createRouteService();
  const waypointError = async (waypoints) =>
    (await errorFrom(() => routeService.createRoute(PARK_ID, routeInput({ waypoints })))).fields
      .waypoints;
  const many = (count) => Array.from({ length: count }, () => NORTH_WAYPOINTS[0]);

  assert.equal(await waypointError([NORTH_WAYPOINTS[0]]), 'A route needs at least 2 waypoints');
  assert.equal(await waypointError(undefined), 'A route needs at least 2 waypoints');
  assert.equal(await waypointError('6.41,81.40'), 'A route needs at least 2 waypoints');
  assert.equal(await waypointError(many(51)), 'A route can have at most 50 waypoints');
  assert.equal(
    await waypointError([NORTH_WAYPOINTS[0], point(95, 81.4)]),
    'Waypoint 2 does not have valid coordinates',
  );
  assert.equal(
    await waypointError([null, NORTH_WAYPOINTS[0]]),
    'Waypoint 1 does not have valid coordinates',
  );
  assert.equal(
    await waypointError([...NORTH_WAYPOINTS, OUTSIDE_PARK]),
    'Waypoint 4 is outside the park zones',
  );
  assert.equal(
    (await routeService.createRoute(PARK_ID, routeInput({ waypoints: many(50) }))).waypoints.length,
    50,
  );
});

test('every invalid field is reported together and nothing is saved', async () => {
  const { routeService } = createRouteService();

  const error = await errorFrom(() =>
    routeService.createRoute(PARK_ID, { name: '', description: 'd'.repeat(301), waypoints: [] }),
  );
  const noInput = await errorFrom(() => routeService.createRoute(PARK_ID));
  const badDescription = await errorFrom(() =>
    routeService.createRoute(PARK_ID, routeInput({ description: 123 })),
  );

  assert.ok(error instanceof ValidationError);
  assert.equal(error.statusCode, 400);
  assert.deepEqual(error.fields, {
    name: 'Route name is required',
    description: 'Description must be 300 characters or fewer',
    waypoints: 'A route needs at least 2 waypoints',
  });
  assert.deepEqual(Object.keys(noInput.fields), ['name', 'waypoints']);
  assert.deepEqual(badDescription.fields, { description: 'Description must be text' });
  assert.equal((await routeService.listRoutes(PARK_ID)).length, 4);
  await assert.rejects(() => routeService.createRoute('PK-NOWHERE', routeInput()), NotFoundError);
});

/* -------------------------------- Editing -------------------------------- */

test('a route that no active patrol uses can be fully edited', async () => {
  const { routeService, repositories } = createRouteService();
  const menikWaypoints = [point(6.47, 81.42), point(6.49, 81.46), point(6.51, 81.5)];

  const updated = await routeService.updateRoute(PARK_ID, 'RT-004', {
    name: 'Menik River Short Line',
    description: 'Shortened after the monsoon.',
    waypoints: menikWaypoints,
  });
  const stored = await repositories.routes.findByRouteId('RT-004');

  assert.equal(updated.routeId, 'RT-004');
  assert.equal(updated.name, 'Menik River Short Line');
  assert.equal(updated.routeLength, roundTo(routeLengthKm(menikWaypoints), 2));
  assert.deepEqual(updated.zoneIds, ['ZN-004']);
  assert.equal(updated.patrolCount, 1);
  assert.equal(stored.waypoints.length, 3);
  assert.equal(stored.description, 'Shortened after the monsoon.');
});

test("a route may keep its own name when edited but may not take another route's name", async () => {
  const { routeService, repositories } = createRouteService();
  const route = await repositories.routes.findByRouteId('RT-004');

  const sameName = await routeService.updateRoute(PARK_ID, 'RT-004', {
    name: route.name,
    description: 'Only the description changed.',
    waypoints: route.waypoints,
  });
  const clash = await errorFrom(() =>
    routeService.updateRoute(PARK_ID, 'RT-004', { ...route, name: 'Block 1 South Track' }),
  );

  assert.equal(sameName.description, 'Only the description changed.');
  assert.deepEqual(clash.fields, { name: 'Another route already has this name' });
});

test('waypoints are locked while a patrol is on the route; name and description are not', async () => {
  const { routeService, repositories } = createRouteService();
  const route = await repositories.routes.findByRouteId('RT-001');

  const renamed = await routeService.updateRoute(PARK_ID, 'RT-001', {
    name: 'Block 1 North Circuit (dry season)',
    description: route.description,
    waypoints: route.waypoints,
  });
  const moved = await errorFrom(() =>
    routeService.updateRoute(PARK_ID, 'RT-001', { ...route, waypoints: NORTH_WAYPOINTS }),
  );
  const shortened = await errorFrom(() =>
    routeService.updateRoute(PARK_ID, 'RT-001', {
      ...route,
      waypoints: route.waypoints.slice(0, 3),
    }),
  );

  assert.equal(renamed.name, 'Block 1 North Circuit (dry season)');
  assert.equal(renamed.hasActivePatrol, true);
  assert.ok(moved instanceof ConflictError);
  assert.equal(moved.statusCode, 409);
  assert.match(moved.message, /Waypoints cannot be changed while a patrol is using this route/);
  assert.ok(shortened instanceof ConflictError);
  assert.equal((await repositories.routes.findByRouteId('RT-001')).waypoints.length, 6);
});

test('editing checks the input and that the route belongs to the park', async () => {
  const { routeService } = createRouteService();

  const invalid = await errorFrom(() => routeService.updateRoute(PARK_ID, 'RT-004'));

  assert.ok(invalid instanceof ValidationError);
  await assert.rejects(
    () => routeService.updateRoute(PARK_ID, 'RT-999', routeInput()),
    NotFoundError,
  );
  await assert.rejects(
    () => routeService.updateRoute('PK-NOWHERE', 'RT-004', routeInput()),
    NotFoundError,
  );
});

/* -------------------------------- Deleting ------------------------------- */

test('only a route that no patrol has ever used can be deleted', async () => {
  const { routeService, repositories } = createRouteService();
  const unused = await routeService.createRoute(PARK_ID, routeInput());

  const inUse = await errorFrom(() => routeService.deleteRoute(PARK_ID, 'RT-001'));
  const inHistory = await errorFrom(() => routeService.deleteRoute(PARK_ID, 'RT-004'));
  await routeService.deleteRoute(PARK_ID, unused.routeId);

  assert.ok(inUse instanceof ConflictError);
  assert.equal(inUse.message, 'This route is used by 3 patrol(s) and cannot be deleted.');
  assert.equal(inHistory.message, 'This route is used by 1 patrol(s) and cannot be deleted.');
  assert.equal(await repositories.routes.findByRouteId(unused.routeId), null);
  assert.equal((await routeService.listRoutes(PARK_ID)).length, 4);
  await assert.rejects(() => routeService.deleteRoute(PARK_ID, 'RT-999'), NotFoundError);
});

/* --------------------------- Validator and storage ----------------------- */

test('RouteValidator works on its own with any limits (SRP, DIP)', () => {
  const strict = new RouteValidator({ ...config.ROUTE, MIN_WAYPOINTS: 3, NAME_MAX_LENGTH: 5 });
  const anywhere = [{ contains: () => true }];
  const context = { zones: anywhere, otherRouteNames: [] };

  let fields = null;
  try {
    strict.assertValid({ name: 'Too long', waypoints: NORTH_WAYPOINTS.slice(0, 2) }, context);
  } catch (error) {
    fields = error.fields;
  }
  const valid = strict.assertValid({ name: 'Loop', waypoints: NORTH_WAYPOINTS }, context);

  assert.deepEqual(fields, {
    name: 'Route name must be 5 characters or fewer',
    waypoints: 'A route needs at least 3 waypoints',
  });
  assert.deepEqual(Object.keys(valid), ['name', 'description', 'waypoints']);
  assert.equal(valid.waypoints.length, 3);
});

test('RouteRepository writes routes inside their park document', async () => {
  const calls = [];
  const model = { updateOne: async (...args) => calls.push(args) };
  const repository = new RouteRepository(model);
  const route = { routeId: 'RT-005', name: 'Loop' };

  await repository.createRoute(PARK_ID, route);
  await repository.updateRoute('RT-005', route);
  await repository.deleteRoute('RT-005');

  assert.deepEqual(calls, [
    [{ parkId: PARK_ID }, { $push: { routes: route } }, { runValidators: true }],
    [{ 'routes.routeId': 'RT-005' }, { $set: { 'routes.$': route } }, { runValidators: true }],
    [{ 'routes.routeId': 'RT-005' }, { $pull: { routes: { routeId: 'RT-005' } } }],
  ]);
  for (const method of ['createRoute', 'updateRoute', 'deleteRoute']) {
    await assert.rejects(
      () => new contracts.RouteWriter()[method](),
      new RegExp(`RouteWriter\\.${method}\\(\\) is not implemented`),
    );
  }
});

/* ---------------------------------- API ---------------------------------- */

function createTestApp() {
  const repositories = createRepositories();
  const app = createPatrolApp({
    repositories,
    gpsService: new MockGpsTrackingService(),
    clock: () => NOW,
    logger: createSilentLogger(),
  });
  return { app, repositories };
}

test('API: routes can be listed, created, edited and deleted', async () => {
  const { app } = createTestApp();
  const base = `/api/parks/${PARK_ID}/routes`;

  const before = await request(app).get(base).expect(200);
  const created = await request(app).post(base).send(routeInput()).expect(201);
  const edited = await request(app)
    .put(`${base}/${created.body.routeId}`)
    .send(routeInput({ name: 'Renamed Loop' }))
    .expect(200);
  await request(app).delete(`${base}/${created.body.routeId}`).expect(204);
  const after = await request(app).get(base).expect(200);

  assert.equal(before.body.routes.length, 4);
  assert.equal(created.body.routeId, 'RT-005');
  assert.deepEqual(created.body.zoneIds, ['ZN-001']);
  assert.equal(edited.body.name, 'Renamed Loop');
  assert.equal(after.body.routes.length, 4);
});

test('API: route errors use 400, 404 and 409 with a clear message', async () => {
  const { app } = createTestApp();
  const base = `/api/parks/${PARK_ID}/routes`;

  const invalid = await request(app).post(base).send({ name: '' }).expect(400);
  const empty = await request(app).post(base).expect(400);
  const unknownPark = await request(app).get('/api/parks/PK-NOWHERE/routes').expect(404);
  const unknownRoute = await request(app).put(`${base}/RT-999`).send(routeInput()).expect(404);
  const inUse = await request(app).delete(`${base}/RT-001`).expect(409);
  const locked = await request(app)
    .put(`${base}/RT-001`)
    .send(routeInput({ name: 'Moved' }))
    .expect(409);

  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.equal(invalid.body.error.fields.name, 'Route name is required');
  assert.equal(empty.body.error.fields.waypoints, 'A route needs at least 2 waypoints');
  assert.equal(unknownPark.body.error.code, 'NOT_FOUND');
  assert.equal(unknownRoute.body.error.message, 'Route RT-999 was not found');
  assert.deepEqual(inUse.body.error, {
    code: 'CONFLICT',
    message: 'This route is used by 3 patrol(s) and cannot be deleted.',
  });
  assert.equal(locked.body.error.code, 'CONFLICT');
});

test('API: only those allowed to manage routes can change them', async () => {
  const buildApp = (guards) => {
    const app = express();
    app.use(express.json());
    createPatrolModule({
      repositories: createRepositories(),
      gpsService: new MockGpsTrackingService(),
      clock: () => NOW,
      logger: createSilentLogger(),
    }).mount(app, guards);
    return app;
  };
  const allow = (req, res, next) => next();
  const refuse = (req, res) => res.status(403).json({ message: 'Forbidden' });
  const base = `/api/parks/${PARK_ID}/routes`;
  const viewerOnly = buildApp({ view: [allow], evaluate: [allow], manage: [refuse] });

  await request(viewerOnly).get(base).expect(200);
  await request(viewerOnly).post(base).send(routeInput()).expect(403);
  await request(viewerOnly).put(`${base}/RT-004`).send(routeInput()).expect(403);
  await request(viewerOnly).delete(`${base}/RT-004`).expect(403);
  // Without a separate "manage" guard, the evaluation guard applies.
  await request(buildApp({ view: [allow], evaluate: [refuse] }))
    .post(base)
    .send(routeInput())
    .expect(403);
});
