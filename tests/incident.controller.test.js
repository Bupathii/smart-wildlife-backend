/**
 * Unit tests for incident.controller.js
 *
 * Framework : node:test  (same as Member 1)
 * Mocking   : require.cache injection before controller require
 * Helpers   : tests/helpers.js  (shared with Member 1)
 *
 * Coverage target: 90%+ statements / branches / functions / lines
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');
const { createResponse, createNext } = require('./helpers');

/* ─── fixed IDs ─────────────────────────────────────────── */
const RANGER_ID = '64b64c1f1c2d3e4f5a6b7c8d';
const REPORT_ID = '64b64c1f1c2d3e4f5a6b7c8f';

/* ─── mongoose stub ──────────────────────────────────────── */
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'mongoose') {
    return {
      isValidObjectId(value) {
        return /^[a-fA-F0-9]{24}$/.test(String(value));
      },
    };
  }
  return originalLoad.apply(this, arguments);
};

/* ─── IncidentReport model stub ──────────────────────────── */
const IncidentReport = {
  create() {},
  find() {},
  countDocuments() {},
};

const modelPath = path.resolve(
  __dirname,
  '../src/models/IncidentReport.js'
);
require.cache[modelPath] = {
  id: modelPath,
  filename: modelPath,
  loaded: true,
  exports: IncidentReport,
};

/* ─── cloudinaryUpload stub ──────────────────────────────── */
let uploadResult = {
  secure_url: 'https://res.cloudinary.com/test/incident.jpg',
  public_id: 'wildlife-incident-reports/incident-1',
};
let uploadError = null;
let deletedIds = [];

const cloudinaryUtil = {
  async uploadBuffer() {
    if (uploadError) throw uploadError;
    return uploadResult;
  },
  async deleteCloudinaryImage(id) {
    deletedIds.push(id);
  },
};

const cloudinaryPath = path.resolve(
  __dirname,
  '../src/utils/cloudinaryUpload.js'
);
require.cache[cloudinaryPath] = {
  id: cloudinaryPath,
  filename: cloudinaryPath,
  loaded: true,
  exports: cloudinaryUtil,
};

/* ─── load controller (after stubs are in cache) ─────────── */
const controller = require('../src/controllers/incident.controller');
Module._load = originalLoad; // restore

/* ─── helpers ────────────────────────────────────────────── */

/** Minimal populated report returned by IncidentReport.create() */
function makeReport(extra = {}) {
  return {
    _id: REPORT_ID,
    incidentType: 'POACHING',
    description: 'Trap found near river',
    severity: 'HIGH',
    incidentStatus: 'SUBMITTED',
    location: {
      source: 'GPS',
      latitude: 7.8731,
      longitude: 80.7718,
      timestamp: new Date(),
    },
    evidence: [
      {
        url: 'https://res.cloudinary.com/test/incident.jpg',
        publicId: 'wildlife-incident-reports/incident-1',
        originalName: 'photo.jpg',
      },
    ],
    ranger: { _id: RANGER_ID, name: 'Ranger A', email: 'a@park.lk', role: 'RANGER' },
    async populate() { return this; },
    async save() { return this; },
    ...extra,
  };
}

/** Default valid request */
function baseReq(overrides = {}) {
  return {
    body: {
      clientIncidentId: 'uuid-001',
      incidentType: 'POACHING',
      description: 'Trap found near river',
      locationSource: 'GPS',
      latitude: '7.8731',
      longitude: '80.7718',
      severity: 'HIGH',
    },
    files: [
      {
        buffer: Buffer.from('fake-image'),
        originalname: 'photo.jpg',
        mimetype: 'image/jpeg',
      },
    ],
    query: {},
    params: { id: REPORT_ID },
    user: { _id: RANGER_ID, role: 'RANGER' },
    ...overrides,
  };
}

/* Reset mutable state between tests */
test.afterEach(() => {
  uploadError = null;
  deletedIds = [];
  uploadResult = {
    secure_url: 'https://res.cloudinary.com/test/incident.jpg',
    public_id: 'wildlife-incident-reports/incident-1',
  };
});

/* ═══════════════════════════════════════════════════════════
   createIncidentReport
   ═══════════════════════════════════════════════════════════ */

test('createIncidentReport — valid GPS submission returns 201', async () => {
  const report = makeReport();
  IncidentReport.create = async () => report;

  const req = baseReq();
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.report._id, REPORT_ID);
  assert.equal(next.calls.length, 0);
});

test('createIncidentReport — valid MANUAL submission returns 201', async () => {
  const report = makeReport({ location: { source: 'MANUAL', latitude: 7.0, longitude: 80.0, timestamp: new Date() } });
  IncidentReport.create = async () => report;

  const req = baseReq({
    body: {
      incidentType: 'SNARE',
      description: 'Snare near village',
      locationSource: 'MANUAL',
      latitude: '7.0',
      longitude: '80.0',
    },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
});

test('createIncidentReport — missing incidentType returns 400 with missingFields', async () => {
  const req = baseReq({ body: { ...baseReq().body, incidentType: '' } });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('incidentType'));
});

test('createIncidentReport — missing description returns 400', async () => {
  const req = baseReq({ body: { ...baseReq().body, description: '   ' } });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('description'));
});

test('createIncidentReport — missing locationSource returns 400', async () => {
  const req = baseReq({ body: { ...baseReq().body, locationSource: '' } });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('locationSource'));
});

test('createIncidentReport — missing latitude returns 400', async () => {
  const req = baseReq({ body: { ...baseReq().body, latitude: '' } });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('latitude'));
});

test('createIncidentReport — missing longitude returns 400', async () => {
  const req = baseReq({ body: { ...baseReq().body, longitude: '' } });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('longitude'));
});

test('createIncidentReport — multiple missing fields reported together', async () => {
  const req = baseReq({
    body: {
      locationSource: 'GPS',
      latitude: '7.0',
      longitude: '80.0',
    },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('incidentType'));
  assert.ok(res.body.missingFields.includes('description'));
});

test('createIncidentReport — invalid locationSource returns 400', async () => {
  const req = baseReq({
    body: { ...baseReq().body, locationSource: 'SATELLITE' },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /GPS or MANUAL/);
});

test('createIncidentReport — latitude provided without longitude returns 400', async () => {
  const req = baseReq({
    body: { ...baseReq().body, longitude: '' },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('longitude'));
});

test('createIncidentReport — no evidence files returns 400', async () => {
  const req = baseReq({ files: [] });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('evidence'));
});

test('createIncidentReport — null files returns 400', async () => {
  const req = baseReq({ files: null });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('evidence'));
});

test('createIncidentReport — Cloudinary upload failure cleans up and calls next', async () => {
  uploadError = new Error('Cloudinary unavailable');

  const req = baseReq();
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  // next called with the error
  assert.equal(next.calls.length, 1);
  assert.equal(next.calls[0].message, 'Cloudinary unavailable');
});

test('createIncidentReport — DB save failure after upload cleans up Cloudinary images', async () => {
  IncidentReport.create = async () => {
    throw new Error('MongoDB write failed');
  };

  const req = baseReq();
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  // The uploaded image should have been cleaned up
  assert.ok(
    deletedIds.includes('wildlife-incident-reports/incident-1'),
    'uploaded image should be deleted on DB failure'
  );
  assert.equal(next.calls.length, 1);
});

test('createIncidentReport — duplicate clientIncidentId returns 409 with alreadySynchronized flag', async () => {
  const dupError = Object.assign(new Error('E11000'), {
    code: 11000,
    keyPattern: { clientIncidentId: 1 },
  });
  IncidentReport.create = async () => { throw dupError; };

  const req = baseReq();
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.alreadySynchronized, true);
  assert.equal(next.calls.length, 0);
});

test('createIncidentReport — other 11000 error (not clientIncidentId) calls next', async () => {
  const dupError = Object.assign(new Error('E11000'), {
    code: 11000,
    keyPattern: { someOtherField: 1 },
  });
  IncidentReport.create = async () => { throw dupError; };

  const req = baseReq();
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(next.calls.length, 1);
});

test('createIncidentReport — Mongoose ValidationError returns 400 with errors array', async () => {
  const valError = Object.assign(new Error('ValidationError'), {
    name: 'ValidationError',
    errors: {
      incidentType: { message: 'incidentType is not a valid enum value' },
      description: { message: 'description is required' },
    },
  });
  IncidentReport.create = async () => { throw valError; };

  const req = baseReq();
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(Array.isArray(res.body.errors));
  assert.ok(res.body.errors.length > 0);
  assert.equal(next.calls.length, 0);
});

test('createIncidentReport — no clientIncidentId (undefined) is accepted', async () => {
  const report = makeReport();
  IncidentReport.create = async () => report;

  const req = baseReq({
    body: { ...baseReq().body, clientIncidentId: undefined },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 201);
});

test('createIncidentReport — empty clientIncidentId string is treated as no ID', async () => {
  const report = makeReport();
  IncidentReport.create = async () => report;

  const req = baseReq({
    body: { ...baseReq().body, clientIncidentId: '   ' },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 201);
});

test('createIncidentReport — description over 1500 chars is passed to Mongoose (schema enforces limit)', async () => {
  // The controller does not pre-truncate; Mongoose validates length.
  // Simulate Mongoose rejecting it with a ValidationError.
  const longDesc = 'x'.repeat(1501);
  const valError = Object.assign(new Error('ValidationError'), {
    name: 'ValidationError',
    errors: {
      description: { message: 'Path `description` exceeds the maximum allowed length (1500).' },
    },
  });
  IncidentReport.create = async () => { throw valError; };

  const req = baseReq({ body: { ...baseReq().body, description: longDesc } });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /1500/);
});

test('createIncidentReport — multiple evidence files produce multiple evidence entries', async () => {
  /*
   * The controller destructures `uploadBuffer` at module load time,
   * so we cannot intercept the call count from outside.
   * Instead we verify the observable outcome: IncidentReport.create
   * is called with an evidence array whose length matches the number
   * of files sent, proving each file was individually processed.
   */
  let capturedData = null;
  IncidentReport.create = async (data) => {
    capturedData = data;
    return makeReport({ evidence: data.evidence });
  };

  const req = baseReq({
    files: [
      { buffer: Buffer.from('a'), originalname: 'a.jpg' },
      { buffer: Buffer.from('b'), originalname: 'b.jpg' },
      { buffer: Buffer.from('c'), originalname: 'c.jpg' },
    ],
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 201, 'should return 201');
  assert.equal(
    capturedData.evidence.length,
    3,
    'evidence array should have one entry per uploaded file'
  );
  assert.ok(next.calls.length === 0, 'no errors');
});

test('createIncidentReport — severity defaults to MEDIUM when not supplied', async () => {
  let captured = null;
  IncidentReport.create = async (data) => {
    captured = data;
    return makeReport();
  };

  const req = baseReq({ body: { ...baseReq().body, severity: undefined } });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(captured.severity, 'MEDIUM');
});

test('createIncidentReport — locationTimestamp is parsed and stored', async () => {
  const ts = '2024-05-01T10:00:00.000Z';
  let captured = null;
  IncidentReport.create = async (data) => {
    captured = data;
    return makeReport();
  };

  const req = baseReq({
    body: { ...baseReq().body, locationTimestamp: ts },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.ok(captured.location.timestamp instanceof Date);
  assert.equal(captured.location.timestamp.toISOString(), ts);
});

test('createIncidentReport — non-numeric latitude / longitude treated as missing', async () => {
  const req = baseReq({
    body: { ...baseReq().body, latitude: 'abc', longitude: 'xyz' },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createIncidentReport(req, res, next);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.missingFields.includes('latitude'));
  assert.ok(res.body.missingFields.includes('longitude'));
});

/* ═══════════════════════════════════════════════════════════
   getMyIncidentReports
   ═══════════════════════════════════════════════════════════ */

function makeListQuery(items, count = items.length) {
  const query = {
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    then(resolve) { return Promise.resolve(items).then(resolve); },
    catch(reject) { return Promise.resolve(items).catch(reject); },
  };
  return query;
}

test('getMyIncidentReports — returns paginated list for authenticated ranger', async () => {
  const reports = [makeReport(), makeReport({ _id: '64b64c1f1c2d3e4f5a6b7c90' })];
  IncidentReport.find = () => makeListQuery(reports);
  IncidentReport.countDocuments = async () => 2;

  const req = { user: { _id: RANGER_ID }, query: {} };
  const res = createResponse();
  const next = createNext();

  await controller.getMyIncidentReports(req, res, next);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.reports.length, 2);
  assert.equal(next.calls.length, 0);
});

test('getMyIncidentReports — returns empty list when ranger has no reports', async () => {
  IncidentReport.find = () => makeListQuery([]);
  IncidentReport.countDocuments = async () => 0;

  const req = { user: { _id: RANGER_ID }, query: {} };
  const res = createResponse();
  const next = createNext();

  await controller.getMyIncidentReports(req, res, next);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 0);
  assert.deepEqual(res.body.reports, []);
});

test('getMyIncidentReports — respects page and limit query params', async () => {
  IncidentReport.find = () => makeListQuery([makeReport()]);
  IncidentReport.countDocuments = async () => 50;

  const req = { user: { _id: RANGER_ID }, query: { page: '3', limit: '10' } };
  const res = createResponse();
  const next = createNext();

  await controller.getMyIncidentReports(req, res, next);

  assert.equal(res.body.page, 3);
  assert.equal(res.body.pages, 5); // ceil(50/10)
});

test('getMyIncidentReports — invalid page defaults to 1', async () => {
  IncidentReport.find = () => makeListQuery([]);
  IncidentReport.countDocuments = async () => 0;

  const req = { user: { _id: RANGER_ID }, query: { page: 'bad' } };
  const res = createResponse();
  const next = createNext();

  await controller.getMyIncidentReports(req, res, next);

  assert.equal(res.body.page, 1);
});

test('getMyIncidentReports — limit capped at 100', async () => {
  IncidentReport.find = () => makeListQuery([]);
  IncidentReport.countDocuments = async () => 0;

  const req = { user: { _id: RANGER_ID }, query: { limit: '500' } };
  const res = createResponse();
  const next = createNext();

  await controller.getMyIncidentReports(req, res, next);

  // Should not throw; limit is capped internally
  assert.equal(res.statusCode, 200);
});

test('getMyIncidentReports — DB error calls next', async () => {
  IncidentReport.find = () => {
    throw new Error('DB error');
  };

  const req = { user: { _id: RANGER_ID }, query: {} };
  const res = createResponse();
  const next = createNext();

  await controller.getMyIncidentReports(req, res, next);

  assert.equal(next.calls.length, 1);
  assert.equal(next.calls[0].message, 'DB error');
});
