const HighRiskZone = require('../models/HighRiskZone');

function normalizeZoneId(name) {
  const cleanName = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, 12)
    .toUpperCase();

  if (cleanName) {
    return cleanName;
  }

  return `ZONE${Date.now().toString().slice(-6)}`;
}

async function listHighRiskZones(req, res) {
  try {
    const zones = await HighRiskZone.find({ status: { $ne: 'INACTIVE' } })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      zones,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to load high-risk zones',
    });
  }
}

async function createHighRiskZone(req, res) {
  try {
    const {
      name,
      latitude,
      longitude,
      radiusMeters,
      riskLevel = 'HIGH',
      status = 'ACTIVE',
      zoneId,
    } = req.body || {};

    if (!String(name || '').trim()) {
      return res.status(400).json({ message: 'Zone name is required' });
    }

    const latitudeNumber = Number(latitude);
    const longitudeNumber = Number(longitude);
    const radiusNumber = Number(radiusMeters);
    const normalizedRiskLevel = String(riskLevel).toUpperCase();
    const normalizedStatus = String(status).toUpperCase();

    if (!Number.isFinite(latitudeNumber) || latitudeNumber < -90 || latitudeNumber > 90) {
      return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
    }

    if (!Number.isFinite(longitudeNumber) || longitudeNumber < -180 || longitudeNumber > 180) {
      return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
    }

    if (!Number.isFinite(radiusNumber) || radiusNumber <= 0 || radiusNumber > 50000) {
      return res.status(400).json({ message: 'Radius must be a positive number less than 50000 meters' });
    }

    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(normalizedRiskLevel)) {
      return res.status(400).json({ message: 'Risk level must be LOW, MEDIUM, HIGH or CRITICAL' });
    }

    if (!['ACTIVE', 'INACTIVE'].includes(normalizedStatus)) {
      return res.status(400).json({ message: 'Status must be ACTIVE or INACTIVE' });
    }

    const zone = new HighRiskZone({
      zoneId: String(zoneId || normalizeZoneId(name)).trim().toUpperCase(),
      name: String(name).trim(),
      latitude: latitudeNumber,
      longitude: longitudeNumber,
      radiusMeters: radiusNumber,
      riskLevel: normalizedRiskLevel,
      status: normalizedStatus,
    });

    const savedZone = await zone.save();

    return res.status(201).json({
      success: true,
      zone: savedZone.toObject(),
    });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }

    if (error?.code === 11000) {
      return res.status(409).json({ message: 'High-risk zone already exists' });
    }

    return res.status(500).json({
      message: error.message || 'Unable to create high-risk zone',
    });
  }
}

async function updateHighRiskZone(req, res) {
  try {
    const zone = await HighRiskZone.findOne({ zoneId: req.params.zoneId });
    if (!zone) {
      return res.status(404).json({ message: 'High-risk zone not found' });
    }

    const {
      name,
      latitude,
      longitude,
      radiusMeters,
      riskLevel,
      status,
    } = req.body || {};
    const nextName = String(name ?? zone.name).trim();
    const nextLatitude = Number(latitude ?? zone.latitude);
    const nextLongitude = Number(longitude ?? zone.longitude);
    const nextRadius = Number(radiusMeters ?? zone.radiusMeters);
    const nextRiskLevel = String(riskLevel ?? zone.riskLevel).toUpperCase();
    const nextStatus = String(status ?? zone.status).toUpperCase();

    if (!nextName) {
      return res.status(400).json({ message: 'Zone name is required' });
    }
    if (!Number.isFinite(nextLatitude) || nextLatitude < -90 || nextLatitude > 90) {
      return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
    }
    if (!Number.isFinite(nextLongitude) || nextLongitude < -180 || nextLongitude > 180) {
      return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
    }
    if (!Number.isFinite(nextRadius) || nextRadius <= 0 || nextRadius > 50000) {
      return res.status(400).json({ message: 'Radius must be a positive number less than 50000 meters' });
    }
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(nextRiskLevel)) {
      return res.status(400).json({ message: 'Risk level must be LOW, MEDIUM, HIGH or CRITICAL' });
    }
    if (!['ACTIVE', 'INACTIVE'].includes(nextStatus)) {
      return res.status(400).json({ message: 'Status must be ACTIVE or INACTIVE' });
    }

    zone.name = nextName;
    zone.latitude = nextLatitude;
    zone.longitude = nextLongitude;
    zone.radiusMeters = nextRadius;
    zone.riskLevel = nextRiskLevel;
    zone.status = nextStatus;
    await zone.save();

    return res.status(200).json({
      success: true,
      zone: zone.toObject(),
    });
  } catch (error) {
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    return res.status(500).json({
      message: error.message || 'Unable to update high-risk zone',
    });
  }
}

async function deleteHighRiskZone(req, res) {
  try {
    const zone = await HighRiskZone.findOneAndDelete({ zoneId: req.params.zoneId });
    if (!zone) {
      return res.status(404).json({ message: 'High-risk zone not found' });
    }
    return res.status(200).json({ success: true, zoneId: zone.zoneId });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'Unable to delete high-risk zone',
    });
  }
}

module.exports = {
  listHighRiskZones,
  createHighRiskZone,
  updateHighRiskZone,
  deleteHighRiskZone,
};
