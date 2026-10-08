const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createHighRiskZone,
  deleteHighRiskZone,
  listHighRiskZones,
  updateHighRiskZone,
} = require('../src/controllers/highRiskZone.controller');

const HighRiskZone = require('../src/models/HighRiskZone');

test('listHighRiskZones returns active zones', async () => {
  const originalFind = HighRiskZone.find;
  HighRiskZone.find = () => ({
    sort: () => ({
      lean: async () => [
        {
          zoneId: 'ZONE001',
          name: 'Village Boundary',
          latitude: 7.8731,
          longitude: 80.7718,
          radiusMeters: 500,
          riskLevel: 'HIGH',
          status: 'ACTIVE',
        },
      ],
    }),
  });

  const req = {};
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  await listHighRiskZones(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.payload.zones), true);
  assert.equal(res.payload.zones[0].zoneId, 'ZONE001');

  HighRiskZone.find = originalFind;
});

test('createHighRiskZone rejects invalid latitude', async () => {
  const originalSave = HighRiskZone.prototype.save;
  HighRiskZone.prototype.save = async () => ({
    zoneId: 'ZONE002',
  });

  const req = {
    body: {
      name: 'Watering Point',
      latitude: 100,
      longitude: 80.7,
      radiusMeters: 300,
      riskLevel: 'HIGH',
    },
  };

  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  await createHighRiskZone(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /Latitude/);

  HighRiskZone.prototype.save = originalSave;
});

test('updateHighRiskZone saves changed zone coordinates and radius', async () => {
  const originalFindOne = HighRiskZone.findOne;
  const zone = {
    zoneId: 'ZONE001',
    name: 'Village Boundary',
    latitude: 7.8731,
    longitude: 80.7718,
    radiusMeters: 500,
    riskLevel: 'HIGH',
    status: 'ACTIVE',
    async save() {
      this.saved = true;
    },
    toObject() {
      return {
        zoneId: this.zoneId,
        name: this.name,
        latitude: this.latitude,
        longitude: this.longitude,
        radiusMeters: this.radiusMeters,
        riskLevel: this.riskLevel,
        status: this.status,
      };
    },
  };
  HighRiskZone.findOne = async () => zone;

  try {
    const res = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    await updateHighRiskZone({
      params: { zoneId: 'ZONE001' },
      body: {
        name: 'Updated Boundary',
        latitude: 6.9271,
        longitude: 79.8612,
        radiusMeters: 900,
        riskLevel: 'CRITICAL',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(zone.saved, true);
    assert.equal(res.payload.zone.latitude, 6.9271);
    assert.equal(res.payload.zone.radiusMeters, 900);
    assert.equal(res.payload.zone.name, 'Updated Boundary');
  } finally {
    HighRiskZone.findOne = originalFindOne;
  }
});

test('deleteHighRiskZone removes a saved zone', async () => {
  const originalFindOneAndDelete = HighRiskZone.findOneAndDelete;
  HighRiskZone.findOneAndDelete = async () => ({ zoneId: 'ZONE001' });

  try {
    const res = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    await deleteHighRiskZone({ params: { zoneId: 'ZONE001' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.zoneId, 'ZONE001');
  } finally {
    HighRiskZone.findOneAndDelete = originalFindOneAndDelete;
  }
});
