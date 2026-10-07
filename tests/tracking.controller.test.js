const test = require('node:test');
const assert = require('node:assert/strict');

const Animal = require('../src/models/Animal');
const HighRiskZone = require('../src/models/HighRiskZone');
const WildlifeRiskAlert = require('../src/models/WildlifeRiskAlert');
const {
  acknowledgeAlert,
  escalateAlert,
  getRangerAlerts,
  resolveAlert,
  submitAnimalLocation,
  updateAlertResponse,
} = require('../src/controllers/tracking.controller');
const { defaultTrackingService } = require('../src/services/wildlifeAlertService');
const { createResponse, createNext } = require('./helpers');

test('submitAnimalLocation generates an alert from an active saved risk zone', async () => {
  const originalAnimalFind = Animal.find;
  const originalAnimalUpdate = Animal.findOneAndUpdate;
  const originalZoneFind = HighRiskZone.find;
  const originalAlertFindOne = WildlifeRiskAlert.findOne;
  const originalAlertUpsert = WildlifeRiskAlert.findOneAndUpdate;
  const originalAnimalCatalog = defaultTrackingService.animalCatalog;
  const originalZones = defaultTrackingService.alertService.highRiskZones;
  const originalAlerts = defaultTrackingService.alertService.alerts;
  const originalRanger = defaultTrackingService.alertService.defaultRanger;
  let savedAlert;
  let savedLocation;

  Animal.find = () => ({
    lean: async () => [
      { animalId: 'ELE001', name: 'Test Elephant', species: 'Elephant' },
    ],
  });
  Animal.findOneAndUpdate = async (filter, update) => {
    savedLocation = { filter, update };
  };
  HighRiskZone.find = () => ({
    lean: async () => [
      {
        zoneId: 'SAVED001',
        name: 'Saved Forest Boundary',
        latitude: 6.9271,
        longitude: 79.8612,
        radiusMeters: 500,
        riskLevel: 'HIGH',
      },
    ],
  });
  WildlifeRiskAlert.findOne = () => ({ lean: async () => null });
  WildlifeRiskAlert.findOneAndUpdate = async (filter, update) => {
    savedAlert = { filter, update };
  };

  try {
    const req = {
      body: {
        animalId: 'ELE001',
        latitude: 6.9271,
        longitude: 79.8612,
        timestamp: '2026-10-07T10:30:00Z',
      },
      user: { _id: 'manager-1', name: 'Park Manager', role: 'PARK_MANAGER' },
    };
    const res = createResponse();
    const next = createNext();

    await submitAnimalLocation(req, res, next);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.alertGenerated, true);
    assert.equal(res.body.message, 'Wildlife risk alert generated');
    assert.equal(savedAlert.update.$set.zoneId, 'SAVED001');
    assert.equal(savedAlert.update.$set.zoneName, 'Saved Forest Boundary');
    assert.equal(savedLocation.filter.animalId, 'ELE001');
    assert.equal(savedLocation.update.$set.currentLocation.latitude, 6.9271);
    assert.equal(savedLocation.update.$set.currentLocation.longitude, 79.8612);
    assert.equal(next.calls.length, 0);
  } finally {
    Animal.find = originalAnimalFind;
    Animal.findOneAndUpdate = originalAnimalUpdate;
    HighRiskZone.find = originalZoneFind;
    WildlifeRiskAlert.findOne = originalAlertFindOne;
    WildlifeRiskAlert.findOneAndUpdate = originalAlertUpsert;
    defaultTrackingService.animalCatalog = originalAnimalCatalog;
    defaultTrackingService.alertService.highRiskZones = originalZones;
    defaultTrackingService.alertService.alerts = originalAlerts;
    defaultTrackingService.alertService.defaultRanger = originalRanger;
  }
});

test('getRangerAlerts returns active alerts stored in MongoDB', async () => {
  const originalFind = WildlifeRiskAlert.find;
  WildlifeRiskAlert.find = () => ({
    sort: () => ({
      lean: async () => [{
        alertId: 'ALERT-001',
        animalId: 'ELE001',
        animalName: 'Test Elephant',
        zoneName: 'Saved Forest Boundary',
        latitude: 6.9271,
        longitude: 79.8612,
        priority: 'HIGH',
        status: 'NEW',
        createdAt: '2026-10-07T10:30:00Z',
      }],
    }),
  });

  try {
    const res = createResponse();
    await getRangerAlerts({}, res, createNext());

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.alerts[0].alertId, 'ALERT-001');
    assert.equal(res.body.alerts[0].zone, 'Saved Forest Boundary');
  } finally {
    WildlifeRiskAlert.find = originalFind;
  }
});

test('Ranger alert actions persist status and response notes', async () => {
  const originalFindOneAndUpdate = WildlifeRiskAlert.findOneAndUpdate;
  const updates = [];
  WildlifeRiskAlert.findOneAndUpdate = (filter, update) => ({
    lean: async () => {
      updates.push({ filter, values: update.$set });
      return { alertId: filter.alertId, ...update.$set };
    },
  });

  try {
    const actions = [
      [acknowledgeAlert, {}, 'ACKNOWLEDGED'],
      [updateAlertResponse, { responseType: 'INVESTIGATE', notes: 'Ranger dispatched' }, 'RESPONSE_INITIATED'],
      [resolveAlert, { notes: 'Animal moved away' }, 'RESOLVED'],
      [escalateAlert, { notes: 'Supervisor assistance requested' }, 'ESCALATED'],
    ];

    for (const [action, body, expectedStatus] of actions) {
      const res = createResponse();
      await action({ params: { alertId: 'ALERT-001' }, body }, res, createNext());
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.alert.status, expectedStatus);
    }

    assert.equal(updates.length, 4);
    assert.equal(updates[1].values.responseNotes, 'Ranger dispatched');
    assert.equal(updates[2].values.responseNotes, 'Animal moved away');
    assert.equal(updates[3].values.responseNotes, 'Supervisor assistance requested');
  } finally {
    WildlifeRiskAlert.findOneAndUpdate = originalFindOneAndUpdate;
  }
});