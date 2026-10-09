const express = require('express');
const { protect, authorize } = require('../middleware/auth.middleware');
const {
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
} = require('../controllers/tracking.controller');

const router = express.Router();

router.use(protect);

router.get('/collar/session', authorize('RANGER'), getCollarTrackingSession);
router.post('/animals/:animalId/tracking/start', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), requestAnimalTracking);
router.get('/animals/:animalId/tracking/session', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), getAnimalTrackingSession);
router.post('/animals/:animalId/tracking/activate', authorize('RANGER'), activateAnimalTracking);
router.post('/animals/:animalId/tracking/stop', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), stopAnimalTracking);

router.post('/location', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), submitAnimalLocation);
router.get('/alerts', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR', 'COMMUNITY_LIAISON_OFFICER'), getRangerAlerts);
router.get('/alerts/:alertId', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR', 'COMMUNITY_LIAISON_OFFICER'), getAlertById);
router.post('/alerts/:alertId/acknowledge', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), acknowledgeAlert);
router.put('/alerts/:alertId/response', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), updateAlertResponse);
router.put('/alerts/:alertId/resolve', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), resolveAlert);
router.put('/alerts/:alertId/escalate', authorize('RANGER', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), escalateAlert);

module.exports = router;
