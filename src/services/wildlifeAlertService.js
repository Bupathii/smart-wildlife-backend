const AlertPriority = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

const AlertStatus = Object.freeze({
  NEW: 'NEW',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESPONSE_INITIATED: 'RESPONSE_INITIATED',
  RESOLVED: 'RESOLVED',
  ESCALATED: 'ESCALATED',
});

class LocationPoint {
  constructor({ latitude, longitude, timestamp }) {
    this.latitude = Number(latitude);
    this.longitude = Number(longitude);
    this.timestamp = timestamp || new Date().toISOString();
  }
}

class Response {
  constructor({ responseType = 'INVESTIGATE', status = 'INITIATED', notes = '' } = {}) {
    this.responseId = `RESP-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    this.responseType = responseType;
    this.initiatedAt = new Date().toISOString();
    this.status = status;
    this.notes = notes;
  }

  updateStatus(nextStatus) {
    this.status = nextStatus;
    return this;
  }

  complete() {
    this.status = 'COMPLETED';
    return this;
  }

  cancel() {
    this.status = 'CANCELLED';
    return this;
  }
}

class HighRiskZone {
  constructor({ id, name, latitude, longitude, radiusMeters, riskLevel = 'HIGH' }) {
    this.id = id;
    this.name = name;
    this.latitude = Number(latitude);
    this.longitude = Number(longitude);
    this.radiusMeters = Number(radiusMeters);
    this.riskLevel = riskLevel;
  }

  containsLocation(location) {
    if (!location) {
      return false;
    }

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return false;
    }

    const earthRadiusMeters = 6371000;
    const latDistance = this.toRadians(latitude - this.latitude);
    const lonDistance = this.toRadians(longitude - this.longitude);
    const lat1 = this.toRadians(this.latitude);
    const lat2 = this.toRadians(latitude);

    const a =
      Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
      Math.sin(lonDistance / 2) * Math.sin(lonDistance / 2) * Math.cos(lat1) * Math.cos(lat2);

    const distance = 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
    return distance <= this.radiusMeters;
  }

  toRadians(value) {
    return (value * Math.PI) / 180;
  }
}

class WildlifeRiskAlert {
  constructor({ animalId, latitude, longitude, zone, ranger, priority = AlertPriority.HIGH }) {
    this.id = `ALERT-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    this.animalId = animalId;
    this.animal = { animalId };
    this.location = new LocationPoint({ latitude, longitude, timestamp: new Date().toISOString() });
    this.highRiskZone = zone;
    this.createdAt = new Date().toISOString();
    this.status = AlertStatus.NEW;
    this.priority = priority;
    this.message = `Animal ${animalId} has entered the ${zone.name} high-risk zone.`;
    this.assignedResponder = ranger;
    this.response = new Response({ responseType: 'INVESTIGATE' });
    this.notification = null;
  }

  acknowledge() {
    this.status = AlertStatus.ACKNOWLEDGED;
    this.acknowledgedAt = new Date().toISOString();
    return this;
  }

  assignResponder(responder) {
    this.assignedResponder = responder;
    return this;
  }

  initiateResponse({ notes = '', responseType = 'INVESTIGATE' } = {}) {
    this.status = AlertStatus.RESPONSE_INITIATED;
    this.response.responseType = responseType;
    this.response.notes = notes;
    this.response.status = 'INITIATED';
    return this;
  }

  resolve({ notes = '' } = {}) {
    this.status = AlertStatus.RESOLVED;
    this.response.notes = notes;
    this.response.status = 'COMPLETED';
    this.resolvedAt = new Date().toISOString();
    return this;
  }

  escalate({ notes = '' } = {}) {
    this.status = AlertStatus.ESCALATED;
    this.response.notes = notes;
    this.response.status = 'CANCELLED';
    this.escalatedAt = new Date().toISOString();
    return this;
  }
}

class Ranger {
  constructor({ id, name, role = 'RANGER' }) {
    this.id = id;
    this.name = name;
    this.role = role;
  }

  viewAlert(alert) {
    return alert;
  }

  acknowledgeAlert(alert) {
    return alert.acknowledge();
  }

  initiateResponse(alert) {
    return alert.initiateResponse();
  }

  resolveAlert(alert) {
    return alert.resolve();
  }

  escalateAlert(alert) {
    return alert.escalate();
  }
}

class InAppNotificationSender {
  async sendNotification(notification) {
    if (!notification) {
      throw new Error('Notification payload is required');
    }

    return {
      success: true,
      delivered: true,
      notification,
    };
  }
}

class NotificationService {
  constructor({ sender } = {}) {
    this.sender = sender || new InAppNotificationSender();
  }

  async sendAlertNotification({ alert, responder }) {
    const payload = {
      title: 'Wildlife Risk Alert',
      message: `${alert.animalId} has entered the ${alert.highRiskZone.name} high-risk zone.`,
      recipient: responder.id,
      alertId: alert.id,
      sentAt: new Date().toISOString(),
      responderName: responder.name,
    };

    const result = await this.sender.sendNotification(payload);

    return {
      sent: true,
      recipient: responder.id,
      ...result,
    };
  }
}

class WildlifeAlertService {
  constructor({ highRiskZones = [], notificationService = new NotificationService(), defaultRanger = new Ranger({ id: 'RNG001', name: 'Ranger 001' }) } = {}) {
    this.highRiskZones = highRiskZones;
    this.notificationService = notificationService;
    this.defaultRanger = defaultRanger;
    this.alerts = [];
  }

  findAlertById(alertId) {
    return this.alerts.find((alert) => alert.id === alertId) || null;
  }

  findMatchingZone(latitude, longitude) {
    return this.highRiskZones.find((zone) => zone.containsLocation({ latitude, longitude })) || null;
  }

  getActiveAlertForAnimal(animalId, zoneId) {
    return (
      this.alerts.find((alert) => {
        const sameAnimal = alert.animalId === String(animalId);
        const sameZone = alert.highRiskZone && alert.highRiskZone.id === zoneId;
        const active = ![AlertStatus.RESOLVED, AlertStatus.ESCALATED].includes(alert.status);
        return sameAnimal && sameZone && active;
      }) || null
    );
  }

  createAlert({ animalId, latitude, longitude, zone, ranger }) {
    const alert = new WildlifeRiskAlert({
      animalId,
      latitude,
      longitude,
      zone,
      ranger: ranger || this.defaultRanger,
      priority: zone.riskLevel === 'HIGH' ? AlertPriority.HIGH : AlertPriority.MEDIUM,
    });

    this.alerts.push(alert);
    return alert;
  }

  async processLocation({ animalId, latitude, longitude, timestamp }) {
    if (!animalId || !String(animalId).trim()) {
      throw new Error('Animal ID is required');
    }

    if (latitude === undefined || longitude === undefined) {
      throw new Error('Latitude and longitude are required');
    }

    const latitudeNumber = Number(latitude);
    const longitudeNumber = Number(longitude);

    if (!Number.isFinite(latitudeNumber) || latitudeNumber < -90 || latitudeNumber > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }

    if (!Number.isFinite(longitudeNumber) || longitudeNumber < -180 || longitudeNumber > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }

    if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
      throw new Error('Invalid timestamp');
    }

    const zone = this.findMatchingZone(latitudeNumber, longitudeNumber);

    if (!zone) {
      return {
        success: true,
        message: 'Location received successfully',
        alertGenerated: false,
        alertId: null,
        priority: null,
        notifiedResponder: null,
      };
    }

    const activeAlert = this.getActiveAlertForAnimal(animalId, zone.id);
    if (activeAlert) {
      return {
        success: true,
        message: 'Wildlife risk alert already active for this animal in this zone',
        alertGenerated: false,
        alertId: activeAlert.id,
        priority: activeAlert.priority,
        notifiedResponder: 'RANGER',
        alert: activeAlert,
        assignedRangerId: activeAlert.assignedResponder.id,
        notification: { sent: false, recipient: activeAlert.assignedResponder.id },
      };
    }

    const alert = this.createAlert({
      animalId,
      latitude: latitudeNumber,
      longitude: longitudeNumber,
      zone,
      ranger: this.defaultRanger,
    });

    const notificationResult = await this.notificationService.sendAlertNotification({
      alert,
      responder: alert.assignedResponder,
    });

    alert.notification = notificationResult;

    return {
      success: true,
      message: 'Wildlife risk alert generated',
      alertGenerated: true,
      alertId: alert.id,
      priority: alert.priority,
      notifiedResponder: 'RANGER',
      alert,
      assignedRangerId: alert.assignedResponder.id,
      notification: {
        sent: true,
        recipient: alert.assignedResponder.id,
      },
    };
  }

  acknowledgeAlert(alertId) {
    const alert = this.findAlertById(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }
    alert.acknowledge();
    return alert;
  }

  initiateAlertResponse(alertId, { responseType = 'INVESTIGATE', notes = '' } = {}) {
    const alert = this.findAlertById(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }
    alert.initiateResponse({ notes, responseType });
    return alert;
  }

  updateAlertResponse(alertId, { responseType = 'INVESTIGATE', notes = '', status = 'INITIATED' } = {}) {
    const alert = this.findAlertById(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }

    alert.response.responseType = responseType;
    alert.response.notes = notes;
    alert.response.status = status;
    return alert;
  }

  resolveAlert(alertId, notes = '') {
    const alert = this.findAlertById(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }
    alert.resolve({ notes });
    return alert;
  }

  escalateAlert(alertId, notes = '') {
    const alert = this.findAlertById(alertId);
    if (!alert) {
      throw new Error('Alert not found');
    }
    alert.escalate({ notes });
    return alert;
  }
}

class GPSTrackingService {
  constructor({ animalCatalog = new Map(), alertService, locationProvider = null } = {}) {
    this.animalCatalog = animalCatalog;
    this.alertService = alertService;
    this.locationProvider = locationProvider;
  }

  validateLocation({ latitude, longitude, timestamp }) {
    if (latitude === undefined || longitude === undefined) {
      throw new Error('Latitude and longitude are required');
    }

    const latitudeNumber = Number(latitude);
    const longitudeNumber = Number(longitude);

    if (!Number.isFinite(latitudeNumber) || latitudeNumber < -90 || latitudeNumber > 90) {
      throw new Error('Latitude must be between -90 and 90');
    }

    if (!Number.isFinite(longitudeNumber) || longitudeNumber < -180 || longitudeNumber > 180) {
      throw new Error('Longitude must be between -180 and 180');
    }

    if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
      throw new Error('Invalid timestamp');
    }
  }

  async getCurrentLocation() {
    if (!this.locationProvider) {
      throw new Error('Location provider is not configured');
    }

    return this.locationProvider.getCurrentLocation();
  }

  async processLocation({ animalId, latitude, longitude, timestamp }) {
    if (!animalId || !String(animalId).trim()) {
      throw new Error('Animal ID is required');
    }

    this.validateLocation({ latitude, longitude, timestamp });

    const normalizedAnimalId = String(animalId).trim();
    const animal = this.animalCatalog.get(normalizedAnimalId);

    if (!animal) {
      throw new Error(`Animal ${normalizedAnimalId} not found`);
    }

    const result = await this.alertService.processLocation({
      animalId: normalizedAnimalId,
      latitude,
      longitude,
      timestamp,
    });

    return {
      ...result,
      animal,
      success: result.success,
    };
  }
}

const defaultAlerts = [
  new HighRiskZone({
    id: 'ZONE001',
    name: 'Village Boundary',
    latitude: 7.8731,
    longitude: 80.7718,
    radiusMeters: 500,
    riskLevel: 'HIGH',
  }),
];

const defaultRanger = new Ranger({ id: 'RNG001', name: 'Ranger 001' });
const defaultNotificationService = new NotificationService({ sender: new InAppNotificationSender() });
const defaultAlertService = new WildlifeAlertService({
  highRiskZones: defaultAlerts,
  notificationService: defaultNotificationService,
  defaultRanger,
});

const defaultAnimalCatalog = new Map([
  ['ELE001', { animalId: 'ELE001', name: 'Elephant 001', species: 'Elephant' }],
]);

const defaultTrackingService = new GPSTrackingService({
  animalCatalog: defaultAnimalCatalog,
  alertService: defaultAlertService,
});

module.exports = {
  AlertPriority,
  AlertStatus,
  HighRiskZone,
  LocationPoint,
  NotificationService,
  InAppNotificationSender,
  Ranger,
  Response,
  WildlifeRiskAlert,
  WildlifeAlertService,
  GPSTrackingService,
  defaultAlertService,
  defaultTrackingService,
  defaultAnimalCatalog,
  defaultRanger,
};
