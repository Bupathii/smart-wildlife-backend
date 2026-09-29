const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const path = require('path');
const Module = require('module');
const { createResponse, createNext, makeQuery } = require('./helpers');

const USER_ID = '64b64c1f1c2d3e4f5a6b7c8d';
const OTHER_ID = '64b64c1f1c2d3e4f5a6b7c8e';
const REPORT_ID = '64b64c1f1c2d3e4f5a6b7c8f';

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

const ConflictReport = {
  find() {},
  create() {},
  findById() {},
  countDocuments() {},
};

const modelPath = path.resolve(__dirname, '../src/models/ConflictReport.js');
require.cache[modelPath] = {
  id: modelPath,
  filename: modelPath,
  loaded: true,
  exports: ConflictReport,
};

const cloudinaryUtilPath = path.resolve(__dirname, '../src/utils/cloudinaryUpload.js');
let uploadResult = {
  secure_url: 'https://example.test/evidence.jpg',
  public_id: 'wildlife-conflict-reports/evidence-1',
};
let uploadError = null;
let deleteError = null;
let deletedImageIds = [];
const cloudinaryUtil = {
  async uploadBuffer() {
    if (uploadError) throw uploadError;
    return uploadResult;
  },
  async deleteCloudinaryImage(id) {
    deletedImageIds.push(id);
    if (deleteError) throw deleteError;
  },
};
require.cache[cloudinaryUtilPath] = {
  id: cloudinaryUtilPath,
  filename: cloudinaryUtilPath,
  loaded: true,
  exports: cloudinaryUtil,
};

const controller = require('../src/controllers/conflict.controller');
Module._load = originalLoad;

function baseReq(overrides = {}) {
  return {
    body: {
      clientReportId: 'client-001',
      conflictType: 'ELEPHANT_SIGHTING',
      description: 'Elephant near the village boundary',
      locationSource: 'GPS',
      latitude: '6.9271',
      longitude: '79.8612',
      manualLocation: '',
    },
    files: [],
    query: {},
    params: { id: REPORT_ID },
    user: { _id: USER_ID, role: 'COMMUNITY_MEMBER' },
    ...overrides,
  };
}

function makeCreatedReport(extra = {}) {
  return {
    _id: REPORT_ID,
    status: 'SUBMITTED',
    urgencyLevel: 'MEDIUM',
    reporter: { _id: USER_ID },
    response: {},
    assignedTo: null,
    async populate() { return this; },
    async save() { return this; },
    ...extra,
  };
}

test.afterEach(() => {
  mock.restoreAll();
  uploadResult = {
    secure_url: 'https://example.test/evidence.jpg',
    public_id: 'wildlife-conflict-reports/evidence-1',
  };
  uploadError = null;
  deleteError = null;
  deletedImageIds = [];
});

test('createConflictReport creates a valid GPS report', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  let createdData;
  mock.method(ConflictReport, 'create', async (data) => {
    createdData = data;
    return makeCreatedReport(data);
  });

  const res = createResponse();
  const next = createNext();
  await controller.createConflictReport(baseReq(), res, next);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.potentialDuplicate, false);
  assert.equal(createdData.status, 'SUBMITTED');
  assert.equal(createdData.urgencyLevel, 'MEDIUM');
  assert.equal(createdData.location.source, 'GPS');
  assert.equal(next.calls.length, 0);
});

test('createConflictReport creates a valid manual-location report', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  let createdData;
  mock.method(ConflictReport, 'create', async (data) => {
    createdData = data;
    return makeCreatedReport(data);
  });

  const req = baseReq({
    body: {
      clientReportId: 'client-manual',
      conflictType: 'CROP_RAIDING',
      description: 'Crop damage near a village',
      locationSource: 'MANUAL',
      manualLocation: '  Udawalawe East Boundary  ',
    },
  });
  const res = createResponse();
  const next = createNext();

  await controller.createConflictReport(req, res, next);

  assert.equal(res.statusCode, 201);
  assert.equal(createdData.location.source, 'MANUAL');
  assert.equal(createdData.location.manualLocation, 'Udawalawe East Boundary');
  assert.equal(next.calls.length, 0);
});

test('createConflictReport accepts MANUAL source with coordinate pair', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  mock.method(ConflictReport, 'create', async (data) => makeCreatedReport(data));
  const res = createResponse();
  await controller.createConflictReport(
    baseReq({
      body: {
        conflictType: 'OTHER',
        description: 'Wildlife near road',
        locationSource: 'MANUAL',
        latitude: '6.9',
        longitude: '79.8',
        manualLocation: '',
      },
    }),
    res,
    createNext()
  );
  assert.equal(res.statusCode, 201);
});

test('createConflictReport validates required fields and location source', async () => {
  const cases = [
    [{ ...baseReq().body, conflictType: '' }, 'Conflict type is required'],
    [{ ...baseReq().body, description: '   ' }, 'Conflict description is required'],
    [{ ...baseReq().body, locationSource: '' }, 'Location source is required'],
    [{ ...baseReq().body, locationSource: 'UNKNOWN' }, 'Location source must be GPS or MANUAL'],
  ];

  for (const [body, message] of cases) {
    const res = createResponse();
    await controller.createConflictReport(baseReq({ body }), res, createNext());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, message);
  }
});

test('createConflictReport validates coordinate combinations', async () => {
  const cases = [
    [
      { ...baseReq().body, latitude: '6.9', longitude: '' },
      'Both latitude and longitude must be provided together',
    ],
    [
      { ...baseReq().body, latitude: '', longitude: '' },
      'Latitude and longitude are required for GPS location',
    ],
    [
      {
        conflictType: 'OTHER',
        description: 'Issue',
        locationSource: 'MANUAL',
        manualLocation: ' ',
      },
      'Manual location or coordinates are required',
    ],
  ];

  for (const [body, message] of cases) {
    const res = createResponse();
    await controller.createConflictReport(baseReq({ body }), res, createNext());
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, message);
  }
});

test('createConflictReport flags a nearby GPS report as potential duplicate and still saves', async () => {
  const oldReport = {
    _id: '64b64c1f1c2d3e4f5a6b7c90',
    location: { latitude: 6.9272, longitude: 79.8613 },
  };
  mock.method(ConflictReport, 'find', () => makeQuery([oldReport]));
  let createdData;
  mock.method(ConflictReport, 'create', async (data) => {
    createdData = data;
    return makeCreatedReport(data);
  });

  const res = createResponse();
  await controller.createConflictReport(baseReq(), res, createNext());

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.potentialDuplicate, true);
  assert.equal(createdData.duplicateInfo.isPotentialDuplicate, true);
  assert.equal(String(createdData.duplicateInfo.duplicateOf), String(oldReport._id));
});

test('createConflictReport finds exact normalized manual-location duplicate', async () => {
  const oldReport = {
    _id: '64b64c1f1c2d3e4f5a6b7c91',
    location: { manualLocation: 'Yala   Gate One' },
  };
  mock.method(ConflictReport, 'find', () => makeQuery([oldReport]));
  let createdData;
  mock.method(ConflictReport, 'create', async (data) => {
    createdData = data;
    return makeCreatedReport(data);
  });

  const res = createResponse();
  await controller.createConflictReport(
    baseReq({
      body: {
        conflictType: 'OTHER',
        description: 'Wildlife sighted',
        locationSource: 'MANUAL',
        manualLocation: ' yala gate one ',
      },
    }),
    res,
    createNext()
  );

  assert.equal(res.statusCode, 201);
  assert.equal(createdData.duplicateInfo.isPotentialDuplicate, true);
});

test('createConflictReport ignores far GPS reports and records no duplicate', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([
    { _id: 'far', location: { latitude: 7.2906, longitude: 80.6337 } },
    { _id: 'missing-coordinates', location: {} },
  ]));
  let createdData;
  mock.method(ConflictReport, 'create', async (data) => {
    createdData = data;
    return makeCreatedReport(data);
  });

  const res = createResponse();
  await controller.createConflictReport(baseReq(), res, createNext());
  assert.equal(createdData.duplicateInfo.isPotentialDuplicate, false);
});

test('createConflictReport uploads optional evidence metadata', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  uploadResult = {
    secure_url: 'https://example.test/photo.jpg',
    public_id: 'photo-1',
  };
  let createdData;
  mock.method(ConflictReport, 'create', async (data) => {
    createdData = data;
    return makeCreatedReport(data);
  });

  const res = createResponse();
  await controller.createConflictReport(
    baseReq({
      files: [{ buffer: Buffer.from('image'), originalname: 'proof.jpg' }],
    }),
    res,
    createNext()
  );

  assert.equal(res.statusCode, 201);
  assert.equal(createdData.evidence.length, 1);
  assert.deepEqual(createdData.evidence[0], {
    url: 'https://example.test/photo.jpg',
    publicId: 'photo-1',
    originalName: 'proof.jpg',
  });
});

test('createConflictReport maps duplicate clientReportId database error to 409', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  mock.method(ConflictReport, 'create', async () => {
    const error = new Error('duplicate key');
    error.code = 11000;
    error.keyPattern = { clientReportId: 1 };
    throw error;
  });

  const res = createResponse();
  await controller.createConflictReport(baseReq(), res, createNext());
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /already been submitted/i);
});

test('createConflictReport maps mongoose validation error to 400', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  mock.method(ConflictReport, 'create', async () => {
    const error = new Error('validation');
    error.name = 'ValidationError';
    error.errors = { conflictType: { message: 'Invalid conflict type' } };
    throw error;
  });

  const res = createResponse();
  await controller.createConflictReport(baseReq({ body: { ...baseReq().body, conflictType: 'BAD_TYPE' } }), res, createNext());
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid conflict type');
});

test('createConflictReport cleans uploaded Cloudinary images and forwards unexpected errors', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  uploadResult = {
    secure_url: 'https://example.test/photo.jpg',
    public_id: 'photo-cleanup',
  };
  const expectedError = new Error('database offline');
  mock.method(ConflictReport, 'create', async () => { throw expectedError; });

  const res = createResponse();
  const next = createNext();
  await controller.createConflictReport(
    baseReq({ files: [{ buffer: Buffer.from('x'), originalname: 'x.jpg' }] }),
    res,
    next
  );

  assert.deepEqual(deletedImageIds, ['photo-cleanup']);
  assert.equal(next.calls[0], expectedError);
});

test('createConflictReport tolerates cleanup deletion failure and still forwards original error', async () => {
  mock.method(console, 'error', () => {});
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  uploadResult = { secure_url: 'u', public_id: 'p' };
  deleteError = new Error('cleanup');
  const original = new Error('db');
  mock.method(ConflictReport, 'create', async () => { throw original; });
  const next = createNext();
  await controller.createConflictReport(
    baseReq({ files: [{ buffer: Buffer.from('x'), originalname: 'x.jpg' }] }),
    createResponse(),
    next
  );
  assert.equal(next.calls[0], original);
});

test('getMyConflictReports returns own reports and supports valid status filter', async () => {
  const reports = [{ _id: REPORT_ID, status: 'RESOLVED' }];
  mock.method(ConflictReport, 'find', (filter) => {
    assert.equal(String(filter.reporter), USER_ID);
    assert.equal(filter.status, 'RESOLVED');
    return makeQuery(reports);
  });
  const res = createResponse();
  await controller.getMyConflictReports(
    baseReq({ query: { status: 'RESOLVED' } }),
    res,
    createNext()
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
});

test('getMyConflictReports rejects invalid status', async () => {
  const res = createResponse();
  await controller.getMyConflictReports(baseReq({ query: { status: 'BAD' } }), res, createNext());
  assert.equal(res.statusCode, 400);
});

test('getMyConflictReports forwards database errors to next', async () => {
  const error = new Error('db');
  mock.method(ConflictReport, 'find', () => makeQuery(null, { rejectWith: error }));
  const next = createNext();
  await controller.getMyConflictReports(baseReq(), createResponse(), next);
  assert.equal(next.calls[0], error);
});

test('getAllConflictReports applies filters, duplicate flag and pagination', async () => {
  let captured;
  mock.method(ConflictReport, 'find', (query) => {
    captured = query;
    return makeQuery([{ _id: REPORT_ID }]);
  });
  mock.method(ConflictReport, 'countDocuments', async () => 11);
  const res = createResponse();
  await controller.getAllConflictReports(
    baseReq({
      query: {
        status: 'RESPONDING',
        conflictType: 'CROP_RAIDING',
        urgencyLevel: 'HIGH',
        duplicate: 'true',
        page: '2',
        limit: '5',
      },
      user: { _id: USER_ID, role: 'RANGER' },
    }),
    res,
    createNext()
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(captured, {
    status: 'RESPONDING',
    conflictType: 'CROP_RAIDING',
    urgencyLevel: 'HIGH',
    'duplicateInfo.isPotentialDuplicate': true,
  });
  assert.equal(res.body.pagination.page, 2);
  assert.equal(res.body.pagination.limit, 5);
  assert.equal(res.body.pagination.totalPages, 3);
});

test('getAllConflictReports supports duplicate=false and limits page size to 50', async () => {
  let captured;
  mock.method(ConflictReport, 'find', (query) => {
    captured = query;
    return makeQuery([]);
  });
  mock.method(ConflictReport, 'countDocuments', async () => 0);
  const res = createResponse();
  await controller.getAllConflictReports(
    baseReq({ query: { duplicate: 'false', page: '-1', limit: '500' } }),
    res,
    createNext()
  );
  assert.equal(captured['duplicateInfo.isPotentialDuplicate'], false);
  assert.equal(res.body.pagination.page, 1);
  assert.equal(res.body.pagination.limit, 50);
  assert.equal(res.body.pagination.totalPages, 0);
});

test('getAllConflictReports rejects invalid status and urgency', async () => {
  for (const query of [{ status: 'BAD' }, { urgencyLevel: 'EXTREME' }]) {
    const res = createResponse();
    await controller.getAllConflictReports(baseReq({ query }), res, createNext());
    assert.equal(res.statusCode, 400);
  }
});

test('getAllConflictReports forwards database errors to next', async () => {
  const error = new Error('db');
  mock.method(ConflictReport, 'find', () => makeQuery(null, { rejectWith: error }));
  mock.method(ConflictReport, 'countDocuments', async () => 0);
  const next = createNext();
  await controller.getAllConflictReports(baseReq(), createResponse(), next);
  assert.equal(next.calls[0], error);
});

test('getConflictReportById rejects invalid ObjectId', async () => {
  const res = createResponse();
  await controller.getConflictReportById(baseReq({ params: { id: 'report-1' } }), res, createNext());
  assert.equal(res.statusCode, 400);
});

test('getConflictReportById returns report to its community owner', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery({
    _id: REPORT_ID,
    reporter: { _id: USER_ID },
  }));
  const res = createResponse();
  await controller.getConflictReportById(baseReq(), res, createNext());
  assert.equal(res.statusCode, 200);
});

test('getConflictReportById blocks another community member', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery({
    _id: REPORT_ID,
    reporter: { _id: OTHER_ID },
  }));
  const res = createResponse();
  await controller.getConflictReportById(baseReq(), res, createNext());
  assert.equal(res.statusCode, 403);
});

test('getConflictReportById allows staff role and blocks unsupported role', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery({
    _id: REPORT_ID,
    reporter: { _id: OTHER_ID },
  }));
  const staff = createResponse();
  await controller.getConflictReportById(
    baseReq({ user: { _id: USER_ID, role: 'RANGER' } }),
    staff,
    createNext()
  );
  assert.equal(staff.statusCode, 200);

  const blocked = createResponse();
  await controller.getConflictReportById(
    baseReq({ user: { _id: USER_ID, role: 'RESEARCHER' } }),
    blocked,
    createNext()
  );
  assert.equal(blocked.statusCode, 403);
});

test('getConflictReportById returns 404 for missing valid ObjectId', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery(null));
  const res = createResponse();
  await controller.getConflictReportById(baseReq(), res, createNext());
  assert.equal(res.statusCode, 404);
});

test('getConflictReportById forwards database error', async () => {
  const error = new Error('db');
  mock.method(ConflictReport, 'findById', () => makeQuery(null, { rejectWith: error }));
  const next = createNext();
  await controller.getConflictReportById(baseReq(), createResponse(), next);
  assert.equal(next.calls[0], error);
});

test('updateConflictResponse rejects invalid ObjectId and unauthorized role', async () => {
  const invalid = createResponse();
  await controller.updateConflictResponse(
    baseReq({ params: { id: 'bad' }, user: { _id: USER_ID, role: 'RANGER' } }),
    invalid,
    createNext()
  );
  assert.equal(invalid.statusCode, 400);

  const forbidden = createResponse();
  await controller.updateConflictResponse(
    baseReq({ user: { _id: USER_ID, role: 'PARK_MANAGER' } }),
    forbidden,
    createNext()
  );
  assert.equal(forbidden.statusCode, 403);
});

test('updateConflictResponse updates status, urgency, assignment and response note', async () => {
  const report = makeCreatedReport({ reporter: { _id: OTHER_ID }, assignedTo: null, response: {} });
  mock.method(ConflictReport, 'findById', () => Promise.resolve(report));
  const res = createResponse();
  await controller.updateConflictResponse(
    baseReq({
      user: { _id: USER_ID, role: 'COMMUNITY_LIAISON_OFFICER' },
      body: {
        status: 'RESPONDING',
        urgencyLevel: 'HIGH',
        responseNote: ' Team dispatched ',
      },
    }),
    res,
    createNext()
  );
  assert.equal(res.statusCode, 200);
  assert.equal(report.status, 'RESPONDING');
  assert.equal(report.urgencyLevel, 'HIGH');
  assert.equal(String(report.assignedTo), USER_ID);
  assert.equal(report.response.note, 'Team dispatched');
  assert.equal(String(report.response.respondedBy), USER_ID);
  assert.ok(report.response.respondedAt instanceof Date);
});

test('updateConflictResponse keeps existing assignment', async () => {
  const report = makeCreatedReport({ assignedTo: OTHER_ID });
  mock.method(ConflictReport, 'findById', () => Promise.resolve(report));
  const res = createResponse();
  await controller.updateConflictResponse(
    baseReq({
      user: { _id: USER_ID, role: 'RANGER' },
      body: { status: 'UNDER_REVIEW' },
    }),
    res,
    createNext()
  );
  assert.equal(res.statusCode, 200);
  assert.equal(String(report.assignedTo), OTHER_ID);
});

test('updateConflictResponse validates status, urgency and response note', async () => {
  const cases = [
    [{ status: 'BAD' }, 'Invalid report status'],
    [{ status: 'SUBMITTED' }, 'Report cannot be changed back to SUBMITTED'],
    [{ urgencyLevel: 'EXTREME' }, 'Invalid urgency level'],
    [{ responseNote: '   ' }, 'Response note cannot be empty'],
  ];

  for (const [body, message] of cases) {
    const report = makeCreatedReport();
    mock.method(ConflictReport, 'findById', () => Promise.resolve(report));
    const res = createResponse();
    await controller.updateConflictResponse(
      baseReq({ user: { _id: USER_ID, role: 'RANGER' }, body }),
      res,
      createNext()
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, message);
    mock.restoreAll();
  }
});

test('updateConflictResponse returns 404 when report is missing', async () => {
  mock.method(ConflictReport, 'findById', () => Promise.resolve(null));
  const res = createResponse();
  await controller.updateConflictResponse(
    baseReq({ user: { _id: USER_ID, role: 'RANGER' }, body: { status: 'UNDER_REVIEW' } }),
    res,
    createNext()
  );
  assert.equal(res.statusCode, 404);
});

test('updateConflictResponse maps validation error to 400', async () => {
  const report = makeCreatedReport({
    async save() {
      const error = new Error('validation');
      error.name = 'ValidationError';
      error.errors = { status: { message: 'Invalid status value' } };
      throw error;
    },
  });
  mock.method(ConflictReport, 'findById', () => Promise.resolve(report));
  const res = createResponse();
  await controller.updateConflictResponse(
    baseReq({ user: { _id: USER_ID, role: 'RANGER' }, body: { status: 'RESOLVED' } }),
    res,
    createNext()
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid status value');
});

test('updateConflictResponse forwards unexpected persistence error', async () => {
  const expected = new Error('db');
  const report = makeCreatedReport({ async save() { throw expected; } });
  mock.method(ConflictReport, 'findById', () => Promise.resolve(report));
  const next = createNext();
  await controller.updateConflictResponse(
    baseReq({ user: { _id: USER_ID, role: 'RANGER' }, body: { status: 'RESOLVED' } }),
    createResponse(),
    next
  );
  assert.equal(next.calls[0], expected);
});
