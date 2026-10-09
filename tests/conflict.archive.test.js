const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const path = require('path');
const Module = require('module');
const { createResponse, makeQuery } = require('./helpers');

const ADMIN_ID = '64b64c1f1c2d3e4f5a6b7c8d';
const REPORT_ID = '64b64c1f1c2d3e4f5a6b7c8f';

const ConflictReport = {
  find() {},
  findById() {},
  countDocuments() {},
  deleteOne() {},
};

const modelPath = path.resolve(__dirname, '../src/models/ConflictReport.js');
require.cache[modelPath] = {
  id: modelPath,
  filename: modelPath,
  loaded: true,
  exports: ConflictReport,
};

const cloudinary = {
  config() {},
  uploader: {
    async destroy() { return { result: 'ok' }; },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'cloudinary') {
    return { v2: cloudinary };
  }
  return originalLoad.apply(this, arguments);
};

const controller = require('../src/controllers/conflictArchive.controller');
Module._load = originalLoad;

function baseReq(overrides = {}) {
  return {
    params: { id: REPORT_ID },
    query: {},
    body: {},
    user: { _id: ADMIN_ID, role: 'ADMIN' },
    ...overrides,
  };
}

function makeReport(overrides = {}) {
  return {
    _id: REPORT_ID,
    evidence: [],
    archiveInfo: {
      isArchived: false,
      reason: '',
      archivedAt: null,
      archivedBy: null,
      restoredAt: null,
      restoredBy: null,
    },
    async save() { return this; },
    ...overrides,
  };
}

test.afterEach(() => mock.restoreAll());

test('getArchivedConflictReports returns paginated archived reports with filters', async () => {
  let filterSeen;
  mock.method(ConflictReport, 'find', (filter) => {
    filterSeen = filter;
    return makeQuery([{ _id: REPORT_ID }]);
  });
  mock.method(ConflictReport, 'countDocuments', async () => 11);

  const res = createResponse();
  await controller.getArchivedConflictReports(
    baseReq({
      query: {
        page: '2',
        limit: '5',
        status: 'RESOLVED',
        conflictType: 'CROP_RAIDING',
        urgency: 'HIGH',
      },
    }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(filterSeen, {
    'archiveInfo.isArchived': true,
    status: 'RESOLVED',
    conflictType: 'CROP_RAIDING',
    urgencyLevel: 'HIGH',
  });
  assert.equal(res.body.pagination.page, 2);
  assert.equal(res.body.pagination.totalPages, 3);
});

test('getArchivedConflictReports normalizes pagination and returns at least one total page', async () => {
  mock.method(ConflictReport, 'find', () => makeQuery([]));
  mock.method(ConflictReport, 'countDocuments', async () => 0);
  const res = createResponse();
  await controller.getArchivedConflictReports(
    baseReq({ query: { page: '-2', limit: '500' } }),
    res
  );
  assert.equal(res.body.pagination.page, 1);
  assert.equal(res.body.pagination.limit, 100);
  assert.equal(res.body.pagination.totalPages, 1);
});

test('getArchivedConflictReports returns 500 on database failure', async () => {
  mock.method(console, 'error', () => {});
  mock.method(ConflictReport, 'find', () => makeQuery(null, { rejectWith: new Error('db') }));
  mock.method(ConflictReport, 'countDocuments', async () => 0);
  const res = createResponse();
  await controller.getArchivedConflictReports(baseReq(), res);
  assert.equal(res.statusCode, 500);
});

test('getAdminConflictReportById returns active or archived report', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery(makeReport({ archiveInfo: { isArchived: true } })));
  const res = createResponse();
  await controller.getAdminConflictReportById(baseReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.report._id, REPORT_ID);
});

test('getAdminConflictReportById returns 404 when missing and 500 on query failure', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery(null));
  const missing = createResponse();
  await controller.getAdminConflictReportById(baseReq(), missing);
  assert.equal(missing.statusCode, 404);

  mock.restoreAll();
  mock.method(console, 'error', () => {});
  mock.method(ConflictReport, 'findById', () => makeQuery(null, { rejectWith: new Error('db') }));
  const failed = createResponse();
  await controller.getAdminConflictReportById(baseReq(), failed);
  assert.equal(failed.statusCode, 500);
});

test('archiveConflictReport requires reason length between 3 and 300', async () => {
  for (const reason of ['', 'x', 'x'.repeat(301)]) {
    const res = createResponse();
    await controller.archiveConflictReport(baseReq({ body: { reason } }), res);
    assert.equal(res.statusCode, 400);
  }
});

test('archiveConflictReport archives active report and stores audit fields', async () => {
  const report = makeReport();
  mock.method(ConflictReport, 'findById', () => makeQuery(report));
  const res = createResponse();
  await controller.archiveConflictReport(
    baseReq({ body: { reason: 'Invalid test report' } }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(report.archiveInfo.isArchived, true);
  assert.equal(report.archiveInfo.reason, 'Invalid test report');
  assert.equal(String(report.archiveInfo.archivedBy), ADMIN_ID);
  assert.ok(report.archiveInfo.archivedAt instanceof Date);
});

test('archiveConflictReport returns 404 when missing, 409 when already archived, 500 on save error', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery(null));
  const missing = createResponse();
  await controller.archiveConflictReport(baseReq({ body: { reason: 'Invalid report' } }), missing);
  assert.equal(missing.statusCode, 404);

  mock.restoreAll();
  mock.method(ConflictReport, 'findById', () => makeQuery(makeReport({ archiveInfo: { isArchived: true } })));
  const duplicate = createResponse();
  await controller.archiveConflictReport(baseReq({ body: { reason: 'Invalid report' } }), duplicate);
  assert.equal(duplicate.statusCode, 409);

  mock.restoreAll();
  mock.method(console, 'error', () => {});
  const broken = makeReport({ async save() { throw new Error('db'); } });
  mock.method(ConflictReport, 'findById', () => makeQuery(broken));
  const failed = createResponse();
  await controller.archiveConflictReport(baseReq({ body: { reason: 'Invalid report' } }), failed);
  assert.equal(failed.statusCode, 500);
});

test('restoreConflictReport restores archived report and stores audit fields', async () => {
  const report = makeReport({
    archiveInfo: {
      isArchived: true,
      reason: 'test',
      archivedAt: new Date(),
      archivedBy: ADMIN_ID,
      restoredAt: null,
      restoredBy: null,
    },
  });
  mock.method(ConflictReport, 'findById', () => makeQuery(report));
  const res = createResponse();
  await controller.restoreConflictReport(baseReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(report.archiveInfo.isArchived, false);
  assert.equal(String(report.archiveInfo.restoredBy), ADMIN_ID);
  assert.ok(report.archiveInfo.restoredAt instanceof Date);
});

test('restoreConflictReport returns 404 when missing, 409 when active, 500 on save error', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery(null));
  const missing = createResponse();
  await controller.restoreConflictReport(baseReq(), missing);
  assert.equal(missing.statusCode, 404);

  mock.restoreAll();
  mock.method(ConflictReport, 'findById', () => makeQuery(makeReport()));
  const active = createResponse();
  await controller.restoreConflictReport(baseReq(), active);
  assert.equal(active.statusCode, 409);

  mock.restoreAll();
  mock.method(console, 'error', () => {});
  const broken = makeReport({ archiveInfo: { isArchived: true }, async save() { throw new Error('db'); } });
  mock.method(ConflictReport, 'findById', () => makeQuery(broken));
  const failed = createResponse();
  await controller.restoreConflictReport(baseReq(), failed);
  assert.equal(failed.statusCode, 500);
});

test('permanent delete refuses active report', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery(makeReport()));
  const res = createResponse();
  await controller.permanentlyDeleteConflictReport(baseReq(), res);
  assert.equal(res.statusCode, 400);
});

test('permanent delete deletes archived report with no evidence', async () => {
  const report = makeReport({ archiveInfo: { isArchived: true }, evidence: [] });
  mock.method(ConflictReport, 'findById', () => makeQuery(report));
  let filterSeen;
  mock.method(ConflictReport, 'deleteOne', async (filter) => {
    filterSeen = filter;
    return { deletedCount: 1 };
  });
  mock.method(console, 'log', () => {});
  const res = createResponse();
  await controller.permanentlyDeleteConflictReport(baseReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(filterSeen, { _id: REPORT_ID });
});

test('permanent delete destroys all evidence in Cloudinary before database deletion', async () => {
  const report = makeReport({
    archiveInfo: { isArchived: true },
    evidence: [{ publicId: 'img-1' }, { publicId: 'img-2' }, {}],
  });
  mock.method(ConflictReport, 'findById', () => makeQuery(report));
  const destroyed = [];
  mock.method(cloudinary.uploader, 'destroy', async (publicId, options) => {
    destroyed.push([publicId, options]);
    return { result: 'ok' };
  });
  let deleted = false;
  mock.method(ConflictReport, 'deleteOne', async () => { deleted = true; return { deletedCount: 1 }; });
  mock.method(console, 'log', () => {});

  const res = createResponse();
  await controller.permanentlyDeleteConflictReport(baseReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(destroyed.map((x) => x[0]).sort(), ['img-1', 'img-2']);
  assert.equal(destroyed[0][1].resource_type, 'image');
  assert.equal(destroyed[0][1].invalidate, true);
  assert.equal(deleted, true);
});

test('permanent delete cancels database deletion when Cloudinary deletion fails', async () => {
  mock.method(console, 'error', () => {});
  const report = makeReport({
    archiveInfo: { isArchived: true },
    evidence: [{ publicId: 'img-1' }],
  });
  mock.method(ConflictReport, 'findById', () => makeQuery(report));
  mock.method(cloudinary.uploader, 'destroy', async () => { throw new Error('cloudinary'); });
  let dbDeleted = false;
  mock.method(ConflictReport, 'deleteOne', async () => { dbDeleted = true; });
  const res = createResponse();
  await controller.permanentlyDeleteConflictReport(baseReq(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(dbDeleted, false);
});

test('permanent delete returns 404 when missing and 500 on database deletion failure', async () => {
  mock.method(ConflictReport, 'findById', () => makeQuery(null));
  const missing = createResponse();
  await controller.permanentlyDeleteConflictReport(baseReq(), missing);
  assert.equal(missing.statusCode, 404);

  mock.restoreAll();
  mock.method(console, 'error', () => {});
  const report = makeReport({ archiveInfo: { isArchived: true }, evidence: [] });
  mock.method(ConflictReport, 'findById', () => makeQuery(report));
  mock.method(ConflictReport, 'deleteOne', async () => { throw new Error('db'); });
  const failed = createResponse();
  await controller.permanentlyDeleteConflictReport(baseReq(), failed);
  assert.equal(failed.statusCode, 500);
});
