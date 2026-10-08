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

module.exports = router;
