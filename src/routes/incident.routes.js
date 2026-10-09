const express = require('express');

const router = express.Router();

const {
  protect,
  authorize,
} = require('../middleware/auth.middleware');

const upload = require('../middleware/upload.middleware');

const {
  createIncidentReport,
  getMyIncidentReports,
  getAllIncidentReports,
  updateIncidentStatus,
} = require('../controllers/incident.controller');

// All routes require a valid JWT
router.use(protect);

// POST /api/incidents — submit a new incident report (multipart/form-data, field "evidence")
router.post(
  '/',
  authorize('RANGER'),
  upload.array('evidence', 5),
  createIncidentReport
);

// GET /api/incidents/my — ranger's own reports
router.get(
  '/my',
  authorize('RANGER'),
  getMyIncidentReports
);

// GET /api/incidents — supervisory roles: view all reports with filters
router.get(
  '/',
  authorize('ADMIN', 'PARK_MANAGER', 'RANGER_SUPERVISOR', 'RESEARCHER'),
  getAllIncidentReports
);

// PATCH /api/incidents/:id/status — status update (PARK_MANAGER / RANGER_SUPERVISOR only)
router.patch(
  '/:id/status',
  authorize('ADMIN', 'PARK_MANAGER', 'RANGER_SUPERVISOR'),
  updateIncidentStatus
);

module.exports = router;
