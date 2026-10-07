'use strict';

/**
 * T-22 API tests (Supertest) for every patrol monitoring endpoint, plus
 * T-19 (unexpected failure → clean 500 JSON). The app is built by the
 * createPatrolApp factory on in-memory repositories and a mock GPS service.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const {
  createPatrolApp,
  createPatrolModule,
  mountPatrolMonitoring,
} = require('../src/patrol.container');
const {
  NOW,
  createRepositories,
  createSilentLogger,
  MockGpsTrackingService,
} = require('./patrol.helpers');

/** A fresh app (and its fakes) for each test, so tests cannot affect each other. */
function createTestApp({ gps = {}, ...repositoryOptions } = {}) {
  const repositories = createRepositories(repositoryOptions);
  const logger = createSilentLogger();
  const app = createPatrolApp({
    repositories,
    gpsService: new MockGpsTrackingService(gps),
    clock: () => NOW,
    logger,
  });
  return { app, repositories, logger };
}

test('T-22 GET /api/patrols/monitoring returns the dashboard', async () => {
  const { app } = createTestApp();

  const response = await request(app).get('/api/patrols/monitoring').expect(200);

  assert.equal(response.body.summary.activePatrols, 4);
  assert.equal(response.body.activePatrols.length, 4);
  assert.equal(response.body.lastUpdated, NOW.toISOString());
  assert.equal(response.body.gpsStatus, 'AVAILABLE');
  assert.equal(response.body.underPatrolledZones.length, 2);
});

test('T-22 GET /api/patrols/monitoring reports GPS failure and the empty state', async () => {
  const gpsDown = await request(createTestApp({ gps: { down: true } }).app)
    .get('/api/patrols/monitoring')
    .expect(200);
  const noActive = await request(createTestApp({ includeActive: false }).app)
    .get('/api/patrols/monitoring')
    .expect(200);

  assert.equal(gpsDown.body.gpsStatus, 'UNAVAILABLE');
  assert.equal(noActive.body.noActivePatrols, true);
  assert.deepEqual(noActive.body.activePatrols, []);
});

test('T-22 GET /api/patrols filters the list and rejects bad filter values', async () => {
  const { app } = createTestApp();

  const completed = await request(app).get('/api/patrols?status=COMPLETED').expect(200);
  const byRanger = await request(app)
    .get('/api/patrols?rangerId=RN-005&status=DELAYED')
    .expect(200);
  const badStatus = await request(app).get('/api/patrols?status=SOLVED').expect(400);
  const badDate = await request(app).get('/api/patrols?from=not-a-date').expect(400);

  assert.equal(completed.body.count, 4);
  assert.deepEqual(
    byRanger.body.patrols.map((patrol) => patrol.patrolId),
    ['PT-004'],
  );
  assert.equal(badStatus.body.error.code, 'VALIDATION_ERROR');
  assert.match(badStatus.body.error.fields.status, /Status must be one of/);
  assert.deepEqual(badDate.body.error.fields, { from: 'Date is not valid' });
});

test('T-22 GET /api/patrols/completed returns history, not a patrol called "completed"', async () => {
  const { app } = createTestApp();

  const response = await request(app).get('/api/patrols/completed').expect(200);

  assert.equal(response.body.statistics.totalCompleted, 4);
  assert.deepEqual(
    response.body.patrols.map((patrol) => patrol.patrolId),
    ['PT-005', 'PT-006', 'PT-007', 'PT-008'],
  );
});

test('T-22 GET /api/patrols/:patrolId returns details or 404', async () => {
  const { app } = createTestApp();

  const found = await request(app).get('/api/patrols/PT-005').expect(200);
  const missing = await request(app).get('/api/patrols/PT-999').expect(404);

  assert.equal(found.body.patrolId, 'PT-005');
  assert.equal(found.body.canEvaluate, true);
  assert.equal(found.body.evaluation.rating, 4);
  assert.deepEqual(missing.body, {
    error: { code: 'NOT_FOUND', message: 'Patrol PT-999 was not found' },
  });
});

test('T-22 GET /api/patrols/:patrolId/coverage returns coverage by zone or 404', async () => {
  const { app } = createTestApp();

  const found = await request(app).get('/api/patrols/PT-006/coverage').expect(200);
  const missing = await request(app).get('/api/patrols/PT-999/coverage').expect(404);

  assert.equal(found.body.percentage, 71.4);
  assert.equal(found.body.zoneCoverage[0].zoneId, 'ZN-002');
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('T-22 PUT /api/patrols/:patrolId/evaluation saves, updates and validates', async () => {
  const { app } = createTestApp();
  const save = (patrolId, body) =>
    request(app).put(`/api/patrols/${patrolId}/evaluation`).send(body);

  const created = await save('PT-006', {
    rating: 5,
    notes: 'Excellent.',
    evaluatedBy: 'PM-001',
  }).expect(200);
  const updated = await save('PT-006', { rating: 3, notes: '', evaluatedBy: 'PM-001' }).expect(200);
  const invalid = await save('PT-006', {
    rating: 9,
    notes: 'x'.repeat(501),
    evaluatedBy: 'PM-001',
  }).expect(400);
  const empty = await save('PT-006', undefined).expect(400);
  const notCompleted = await save('PT-001', { rating: 4, evaluatedBy: 'PM-001' }).expect(400);
  const missing = await save('PT-999', { rating: 4, evaluatedBy: 'PM-001' }).expect(404);

  assert.equal(created.body.updated, false);
  assert.equal(created.body.evaluation.evaluatedAt, NOW.toISOString());
  assert.equal(updated.body.updated, true);
  assert.equal(updated.body.evaluation.rating, 3);
  assert.deepEqual(invalid.body.error.fields, {
    rating: 'Rating must be between 1 and 5',
    notes: 'Notes must be 500 characters or fewer',
  });
  assert.equal(empty.body.error.fields.rating, 'Rating is required');
  assert.equal(
    notCompleted.body.error.message,
    'Evaluation available after the patrol is completed',
  );
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('T-22 GET /api/parks/:parkId/zones returns the map data or 404', async () => {
  const { app } = createTestApp();

  const found = await request(app).get('/api/parks/PK-YALA/zones').expect(200);
  const missing = await request(app).get('/api/parks/PK-NOWHERE/zones').expect(404);

  assert.equal(found.body.park.name, 'Yala National Park');
  assert.equal(found.body.zones.length, 4);
  assert.equal(found.body.zones[0].boundary.length, 4);
  assert.equal(found.body.routes.length, 4);
  assert.equal(missing.body.error.message, 'Park PK-NOWHERE was not found');
});

test('T-22 GET /api/rangers and /api/rangers/:rangerId/location', async () => {
  const { app } = createTestApp();

  const list = await request(app).get('/api/rangers').expect(200);
  const offline = await request(app).get('/api/rangers/RN-003/location').expect(200);
  const missing = await request(app).get('/api/rangers/RN-999/location').expect(404);

  assert.equal(list.body.rangers.length, 9);
  assert.equal(offline.body.trackingStatus, 'OFFLINE');
  assert.equal(typeof offline.body.location.latitude, 'number');
  assert.equal(offline.body.gpsStatus, 'AVAILABLE');
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('T-19 a repository failure becomes a logged, clean 500 response', async () => {
  const { app, repositories, logger } = createTestApp();
  repositories.patrols.findInProgress = async () => {
    throw new Error('connection to database lost');
  };

  const response = await request(app).get('/api/patrols/monitoring').expect(500);

  assert.deepEqual(response.body, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong while loading patrol data. Please try again.',
    },
  });
  assert.equal(JSON.stringify(response.body).includes('database'), false, 'no internals leaked');
  assert.equal(logger.entries.length, 1);
  assert.equal(logger.entries[0].level, 'error');
  assert.equal(logger.entries[0].message, 'GET /api/patrols/monitoring failed');
  assert.equal(logger.entries[0].details.message, 'connection to database lost');
});

test('T-19 handled errors are logged too', async () => {
  const { app, logger } = createTestApp();

  await request(app).get('/api/patrols/PT-999').expect(404);

  assert.equal(logger.entries.length, 1);
  assert.equal(logger.entries[0].details.code, 'NOT_FOUND');
});

test('guards supplied by the host application run before the handlers', async () => {
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
  const asManager = (req, res, next) => {
    req.user = { id: 'USR-42' };
    next();
  };
  const refuse = (req, res) => res.status(403).json({ message: 'Forbidden' });
  const body = { rating: 4, notes: 'Good.', evaluatedBy: 'someone-else' };

  const identified = await request(buildApp({ view: [asManager] }))
    .put('/api/patrols/PT-006/evaluation')
    .send(body)
    .expect(200);
  const blocked = buildApp({ view: [asManager], evaluate: [refuse] });

  assert.equal(identified.body.evaluation.evaluatedBy, 'USR-42', 'the known user wins');
  await request(blocked).put('/api/patrols/PT-006/evaluation').send(body).expect(403);
  await request(blocked).get('/api/patrols/completed').expect(200);
});

test('the main application mounts the routes behind its existing access control', async () => {
  const app = express();
  app.use(express.json());
  mountPatrolMonitoring(app);

  for (const path of ['/api/patrols/monitoring', '/api/parks/PK-YALA/zones', '/api/rangers']) {
    const response = await request(app).get(path).expect(401);
    assert.equal(response.body.message, 'Not authenticated');
  }
});
