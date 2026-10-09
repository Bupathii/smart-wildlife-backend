const Animal = require('../models/Animal');
const HighRiskZoneModel = require('../models/HighRiskZone');
const WildlifeRiskAlertModel = require('../models/WildlifeRiskAlert');
const {
  HighRiskZone,
  Ranger,
  defaultTrackingService,
} = require('../services/wildlifeAlertService');

const defaultPrototypeZone = new HighRiskZone({
  id: 'ZONE001',
  name: 'Village Boundary',
  latitude: 7.8731,
  longitude: 80.7718,
  radiusMeters: 500,
  riskLevel: 'HIGH',
});

const CLOSED_ALERT_STATUSES = ['RESOLVED', 'ESCALATED'];

async function saveAnimalLocation(animalId, latitude, longitude, timestamp) {
  await Animal.findOneAndUpdate(
    { animalId },
    {
      $set: {
        currentLocation: {
          latitude: Number(latitude),
          longitude: Number(longitude),
          lastUpdated: new Date(timestamp),
        },
      },
    },
    { new: true, runValidators: true }
  );
}

async function buildTrackingService(req) {
  const animalDocs = await Animal.find({}, { animalId: 1, name: 1, species: 1 }).lean();
  const animalCatalog = new Map(animalDocs.map((animal) => [animal.animalId, animal]));

  const zoneDocs = await HighRiskZoneModel.find({ status: { $ne: 'INACTIVE' } }).lean();
  const highRiskZones = zoneDocs.length
    ? zoneDocs.map((zone) => new HighRiskZone({
        id: zone.zoneId,
        name: zone.name,
        latitude: zone.latitude,
        longitude: zone.longitude,
        radiusMeters: zone.radiusMeters,
        riskLevel: zone.riskLevel,
      }))
    : [defaultPrototypeZone];

  defaultTrackingService.animalCatalog = animalCatalog;
  defaultTrackingService.alertService.highRiskZones = highRiskZones;
  defaultTrackingService.alertService.defaultRanger = new Ranger({
    id: req.user?._id?.toString?.() || 'RNG001',
    name: req.user?.name || 'Ranger 001',
    role: req.user?.role || 'RANGER',
  });

  return defaultTrackingService;
}

async function submitAnimalLocation(req, res, next) {
  try {
    const { animalId, latitude, longitude, timestamp } = req.body || {};
    const normalizedAnimalId = String(animalId || '').trim().toUpperCase();

    if (!normalizedAnimalId) {
      return res.status(400).json({ message: 'Animal ID is required' });
    }

    const trackingService = await buildTrackingService(req);
    trackingService.validateLocation({ latitude, longitude, timestamp });
    const animal = trackingService.animalCatalog.get(normalizedAnimalId);
    if (!animal) {
      throw new Error(`Animal ${normalizedAnimalId} not found`);
    }

    const registeredAnimal = await Animal.findOne({ animalId: normalizedAnimalId })
      .select('trackingSession')
      .lean();
    const sessionOwnerId = registeredAnimal?.trackingSession?.requestedBy?.toString?.();
    const rangerId = req.user?._id?.toString?.();
    if (
      registeredAnimal?.trackingSession?.status !== 'ACTIVE' ||
      !sessionOwnerId ||
      sessionOwnerId !== rangerId
    ) {
      return res.status(409).json({ message: 'No active tracking session for this Ranger and animal' });
    }

    const matchedZone = trackingService.alertService.findMatchingZone(latitude, longitude);
    if (matchedZone) {
      const savedActiveAlert = await WildlifeRiskAlertModel.findOne({
        animalId: normalizedAnimalId,
        zoneId: matchedZone.id,
        status: { $nin: CLOSED_ALERT_STATUSES },
      }).lean();

      if (savedActiveAlert) {
        await saveAnimalLocation(normalizedAnimalId, latitude, longitude, timestamp);
        return res.status(200).json({
          success: true,
          message: 'Wildlife risk alert already active for this animal in this zone',
          alertGenerated: false,
          alertId: savedActiveAlert.alertId,
          priority: savedActiveAlert.priority,
          notifiedResponder: 'RANGER',
          assignedRangerId: savedActiveAlert.assignedResponderId || null,
          animal,
        });
      }
    }

    trackingService.alertService.alerts = [];
    const result = await trackingService.processLocation({
      animalId: normalizedAnimalId,
      latitude,
      longitude,
      timestamp,
    });

    await saveAnimalLocation(normalizedAnimalId, latitude, longitude, timestamp);

    const alertPayload = result.alert || null;
    if (alertPayload && result.alertGenerated) {
      await WildlifeRiskAlertModel.findOneAndUpdate(
        { alertId: alertPayload.id },
        {
          $set: {
            alertId: alertPayload.id,
            animalId: alertPayload.animalId,
            animalName: alertPayload.animal?.name || alertPayload.animalId,
            latitude: alertPayload.location.latitude,
            longitude: alertPayload.location.longitude,
            zoneId: alertPayload.highRiskZone.id,
            zoneName: alertPayload.highRiskZone.name,
            status: alertPayload.status,
            priority: alertPayload.priority,
            assignedResponderId: alertPayload.assignedResponder.id,
            assignedResponderName: alertPayload.assignedResponder.name,
            message: alertPayload.message,
            notifiedAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: result.message,
      alertGenerated: result.alertGenerated,
      alertId: result.alertId || null,
      priority: result.priority || null,
      notifiedResponder: result.notifiedResponder || null,
      assignedRangerId: result.assignedRangerId || null,
      animal: result.animal || null,
    });
  } catch (error) {
    const message = error.message || 'Unable to process tracking location';
    if (
      message.includes('Latitude') ||
      message.includes('Longitude') ||
      message.includes('Animal ID') ||
      message.includes('Invalid timestamp') ||
      message.includes('not found')
    ) {
      return res.status(400).json({ message });
    }

    return next(error);
  }
}

async function getRangerAlerts(req, res, next) {
  try {
    const savedAlerts = await WildlifeRiskAlertModel.find({
      status: { $nin: CLOSED_ALERT_STATUSES },
    }).sort({ createdAt: -1 }).lean();
    const alerts = savedAlerts.map((alert) => ({
      alertId: alert.alertId,
      animalId: alert.animalId,
      animalName: alert.animalName,
      zone: alert.zoneName,
      latitude: alert.latitude,
      longitude: alert.longitude,
      priority: alert.priority,
      status: alert.status,
      timestamp: alert.createdAt,
    }));

    return res.status(200).json({
      success: true,
      alerts,
    });
  } catch (error) {
    return next(error);
  }
}

async function getAlertById(req, res, next) {
  try {
    const alert = await WildlifeRiskAlertModel.findOne({
      alertId: req.params.alertId,
    }).lean();
    if (!alert) {
      return res.status(404).json({ message: 'Alert not found' });
    }
    return res.status(200).json({ success: true, alert });
  } catch (error) {
    return next(error);
  }
}

async function acknowledgeAlert(req, res, next) {
  try {
    const alert = await WildlifeRiskAlertModel.findOneAndUpdate(
      { alertId: req.params.alertId },
      { $set: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() } },
      { new: true, runValidators: true }
    ).lean();
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    return res.status(200).json({ success: true, message: 'Alert acknowledged', alert });
  } catch (error) {
    return next(error);
  }
}

async function updateAlertResponse(req, res, next) {
  try {
    const { responseType = 'INVESTIGATE', notes = '' } = req.body || {};
    const alert = await WildlifeRiskAlertModel.findOneAndUpdate(
      { alertId: req.params.alertId },
      {
        $set: {
          status: 'RESPONSE_INITIATED',
          responseType,
          responseNotes: notes,
        },
      },
      { new: true, runValidators: true }
    ).lean();
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    return res.status(200).json({ success: true, message: 'Response updated', alert });
  } catch (error) {
    return next(error);
  }
}

async function resolveAlert(req, res, next) {
  try {
    const alert = await WildlifeRiskAlertModel.findOneAndUpdate(
      { alertId: req.params.alertId },
      {
        $set: {
          status: 'RESOLVED',
          responseNotes: req.body?.notes || '',
          resolvedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    ).lean();
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    return res.status(200).json({ success: true, message: 'Alert resolved', alert });
  } catch (error) {
    return next(error);
  }
}

async function escalateAlert(req, res, next) {
  try {
    const alert = await WildlifeRiskAlertModel.findOneAndUpdate(
      { alertId: req.params.alertId },
      {
        $set: {
          status: 'ESCALATED',
          responseNotes: req.body?.notes || '',
          escalatedAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    ).lean();
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    return res.status(200).json({ success: true, message: 'Alert escalated', alert });
  } catch (error) {
    return next(error);
  }
}

async function requestAnimalTracking(req, res, next) {
  try {
    const animalId = String(req.params.animalId || '').trim().toUpperCase();
    const animal = await Animal.findOneAndUpdate(
      {
        animalId,
        status: 'ACTIVE',
        'trackingSession.status': { $in: ['STOPPED', null] },
      },
      {
        $set: {
          trackingSession: {
            status: 'REQUESTED',
            requestedBy: req.user._id,
            requestedAt: new Date(),
            startedAt: null,
            stoppedAt: null,
          },
        },
      },
      { new: true, runValidators: true }
    ).select('animalId name trackingSession').lean();

    if (!animal) {
      return res.status(409).json({ message: 'Animal is inactive or already has a tracking session' });
    }
    return res.status(202).json({ success: true, animal });
  } catch (error) {
    return next(error);
  }
}

async function getCollarTrackingSession(req, res, next) {
  try {
    const animal = await Animal.findOne({
      status: 'ACTIVE',
      'trackingSession.requestedBy': req.user._id,
      'trackingSession.status': { $in: ['REQUESTED', 'ACTIVE'] },
    })
      .sort({ 'trackingSession.requestedAt': 1 })
      .select('animalId name species trackingSession')
      .lean();

    return res.status(200).json({
      success: true,
      session: animal ? {
        animalId: animal.animalId,
        name: animal.name,
        species: animal.species,
        status: animal.trackingSession.status,
        requestedAt: animal.trackingSession.requestedAt,
      } : null,
    });
  } catch (error) {
    return next(error);
  }
}

async function getAnimalTrackingSession(req, res, next) {
  try {
    const animal = await Animal.findOne({
      animalId: String(req.params.animalId || '').trim().toUpperCase(),
      'trackingSession.requestedBy': req.user._id,
    }).select('animalId trackingSession').lean();

    if (!animal) {
      return res.status(404).json({ message: 'Tracking session not found' });
    }
    return res.status(200).json({ success: true, session: animal.trackingSession });
  } catch (error) {
    return next(error);
  }
}

async function activateAnimalTracking(req, res, next) {
  try {
    const animal = await Animal.findOneAndUpdate(
      {
        animalId: String(req.params.animalId || '').trim().toUpperCase(),
        'trackingSession.requestedBy': req.user._id,
        'trackingSession.status': 'REQUESTED',
      },
      {
        $set: {
          'trackingSession.status': 'ACTIVE',
          'trackingSession.startedAt': new Date(),
        },
      },
      { new: true, runValidators: true }
    ).select('animalId trackingSession').lean();

    if (!animal) {
      return res.status(409).json({ message: 'No pending tracking request for this animal' });
    }
    return res.status(200).json({ success: true, session: animal.trackingSession });
  } catch (error) {
    return next(error);
  }
}

async function stopAnimalTracking(req, res, next) {
  try {
    const animal = await Animal.findOneAndUpdate(
      {
        animalId: String(req.params.animalId || '').trim().toUpperCase(),
        'trackingSession.requestedBy': req.user._id,
        'trackingSession.status': { $in: ['REQUESTED', 'ACTIVE'] },
      },
      {
        $set: {
          'trackingSession.status': 'STOPPED',
          'trackingSession.stoppedAt': new Date(),
        },
      },
      { new: true, runValidators: true }
    ).select('animalId trackingSession').lean();

    if (!animal) {
      return res.status(404).json({ message: 'Active tracking session not found' });
    }
    return res.status(200).json({ success: true, session: animal.trackingSession });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  submitAnimalLocation,
  getRangerAlerts,
  getAlertById,
  acknowledgeAlert,
  updateAlertResponse,
  resolveAlert,
  escalateAlert,
  requestAnimalTracking,
  getCollarTrackingSession,
  getAnimalTrackingSession,
  activateAnimalTracking,
  stopAnimalTracking,
};
