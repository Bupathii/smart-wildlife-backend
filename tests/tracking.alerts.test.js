const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HighRiskZone,
  WildlifeAlertService,
  GPSTrackingService,
  NotificationService,
  InAppNotificationSender,
  Ranger,
  AlertPriority,
  AlertStatus,
} = require('../src/services/wildlifeAlertService');

const animalCatalog = new Map([
  ['ELE001', { animalId: 'ELE001', name: 'Elephant 001', species: 'Elephant' }],
]);

const zone = new HighRiskZone({
  id: 'ZONE001',
  name: 'Village Boundary',
  latitude: 7.8731,
  longitude: 80.7718,
  radiusMeters: 500,
  riskLevel: 'HIGH',
});

const ranger = new Ranger({
  id: 'RNG001',
  name: 'Ranger 001',
  role: 'RANGER',
});

const notificationSender = new InAppNotificationSender();
const notificationService = new NotificationService({ sender: notificationSender });
const alertService = new WildlifeAlertService({
  highRiskZones: [zone],
  notificationService,
  defaultRanger: ranger,
});

const trackingService = new GPSTrackingService({
  animalCatalog,
  alertService,
});

test('TEST 01 - valid GPS location is accepted', async () => {
  const result = await trackingService.processLocation({
    animalId: 'ELE001',
    latitude: 7.8700,
    longitude: 80.7680,
    timestamp: '2026-10-07T10:30:00Z',
  });

  assert.equal(result.success, true);
  assert.equal(result.alertGenerated, false);
});

test('TEST 02 - invalid latitude is rejected', async () => {
  await assert.rejects(
    () => trackingService.processLocation({
      animalId: 'ELE001',
      latitude: 91,
      longitude: 80.7680,
      timestamp: '2026-10-07T10:30:00Z',
    }),
    /Latitude must be between -90 and 90/
  );
});

test('TEST 03 - invalid longitude is rejected', async () => {
  await assert.rejects(
    () => trackingService.processLocation({
      animalId: 'ELE001',
      latitude: 7.8700,
      longitude: 181,
      timestamp: '2026-10-07T10:30:00Z',
    }),
    /Longitude must be between -180 and 180/
  );
});

test('TEST 04 - unknown animal is rejected', async () => {
  await assert.rejects(
    () => trackingService.processLocation({
      animalId: 'UNKNOWN',
      latitude: 7.8700,
      longitude: 80.7680,
      timestamp: '2026-10-07T10:30:00Z',
    }),
    /Animal .* not found/
  );
});

test('TEST 05 - animal outside high-risk zone does not create alert', async () => {
  const result = await trackingService.processLocation({
    animalId: 'ELE001',
    latitude: 7.8700,
    longitude: 80.7680,
    timestamp: '2026-10-07T10:35:00Z',
  });

  assert.equal(result.alertGenerated, false);
  assert.equal(result.message, 'Location received successfully');
});

test('TEST 06 - animal entering high-risk zone creates alert', async () => {
  const result = await trackingService.processLocation({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    timestamp: '2026-10-07T10:40:00Z',
  });

  assert.equal(result.alertGenerated, true);
  assert.equal(result.priority, AlertPriority.HIGH);
  assert.equal(result.notifiedResponder, 'RANGER');
});

test('TEST 07 - correct alert priority is set', async () => {
  const result = await trackingService.processLocation({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    timestamp: '2026-10-07T10:45:00Z',
  });

  assert.equal(result.priority, AlertPriority.HIGH);
  assert.equal(result.alert.status, AlertStatus.NEW);
});

test('TEST 08 - correct Ranger is assigned', async () => {
  const result = await trackingService.processLocation({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    timestamp: '2026-10-07T10:50:00Z',
  });

  assert.equal(result.assignedRangerId, 'RNG001');
  assert.equal(result.alert.assignedResponder.id, 'RNG001');
});

test('TEST 09 - Ranger receives notification', async () => {
  const freshAlertService = new WildlifeAlertService({
    highRiskZones: [zone],
    notificationService,
    defaultRanger: ranger,
  });

  const freshTrackingService = new GPSTrackingService({
    animalCatalog,
    alertService: freshAlertService,
  });

  const result = await freshTrackingService.processLocation({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    timestamp: '2026-10-07T10:55:00Z',
  });

  assert.equal(result.notification.sent, true);
  assert.equal(result.notification.recipient, 'RNG001');
});

test('TEST 10 - Ranger acknowledges alert', () => {
  const alert = alertService.createAlert({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    zone,
    ranger,
  });

  alert.acknowledge();

  assert.equal(alert.status, AlertStatus.ACKNOWLEDGED);
});

test('TEST 11 - Ranger initiates response', () => {
  const alert = alertService.createAlert({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    zone,
    ranger,
  });

  alert.initiateResponse();

  assert.equal(alert.status, AlertStatus.RESPONSE_INITIATED);
});

test('TEST 12 - response status is updated', () => {
  const alert = alertService.createAlert({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    zone,
    ranger,
  });

  alert.initiateResponse();
  alert.response.updateStatus('IN_PROGRESS');

  assert.equal(alert.response.status, 'IN_PROGRESS');
});

test('TEST 13 - alert can be resolved', () => {
  const alert = alertService.createAlert({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    zone,
    ranger,
  });

  alert.resolve();

  assert.equal(alert.status, AlertStatus.RESOLVED);
});

test('TEST 14 - alert can be escalated', () => {
  const alert = alertService.createAlert({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    zone,
    ranger,
  });

  alert.escalate();

  assert.equal(alert.status, AlertStatus.ESCALATED);
});

test('TEST 15 - duplicate alert prevention for same zone', async () => {
  const duplicate = await trackingService.processLocation({
    animalId: 'ELE001',
    latitude: 7.8735,
    longitude: 80.7721,
    timestamp: '2026-10-07T11:00:00Z',
  });

  assert.equal(duplicate.alertGenerated, false);
  assert.equal(duplicate.message, 'Wildlife risk alert already active for this animal in this zone');
});

test('TEST 16 - notification failure is handled', async () => {
  const failingSender = {
    sendNotification: async () => {
      throw new Error('Notification channel unavailable');
    },
  };

  const failingService = new WildlifeAlertService({
    highRiskZones: [zone],
    notificationService: new NotificationService({ sender: failingSender }),
    defaultRanger: ranger,
  });

  await assert.rejects(
    () => failingService.processLocation({
      animalId: 'ELE001',
      latitude: 7.8735,
      longitude: 80.7721,
      timestamp: '2026-10-07T11:05:00Z',
    }),
    /Notification channel unavailable/
  );
});

test('TEST 17 - GPS provider failure is handled', async () => {
  const badTracking = new GPSTrackingService({
    animalCatalog,
    alertService,
    locationProvider: {
      getCurrentLocation: async () => {
        throw new Error('GPS unavailable');
      },
    },
  });

  await assert.rejects(
    () => badTracking.getCurrentLocation(),
    /GPS unavailable/
  );
});

test('TEST 18 - backend invalid request is rejected', async () => {
  await assert.rejects(
    () => trackingService.processLocation({
      animalId: '',
      latitude: 7.8735,
      longitude: 80.7721,
      timestamp: 'not-a-date',
    }),
    /Animal ID is required|Invalid timestamp/
  );
});
