const express = require('express');
const { protect, authorize } = require('../middleware/auth.middleware');
const {
  listHighRiskZones,
  createHighRiskZone,
  updateHighRiskZone,
  deleteHighRiskZone,
} = require('../controllers/highRiskZone.controller');

const router = express.Router();

router.use(protect);
router.get('/', authorize('ADMIN', 'PARK_MANAGER', 'RANGER_SUPERVISOR', 'RANGER'), listHighRiskZones);
router.post('/', authorize('ADMIN', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), createHighRiskZone);
router.put('/:zoneId', authorize('ADMIN', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), updateHighRiskZone);
router.delete('/:zoneId', authorize('ADMIN', 'PARK_MANAGER', 'RANGER_SUPERVISOR'), deleteHighRiskZone);

module.exports = router;
