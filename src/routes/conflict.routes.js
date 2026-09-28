const express = require('express');

const {
  createConflictReport,
  getMyConflictReports,
  getAllConflictReports,
  getConflictReportById,
  updateConflictResponse,
} = require('../controllers/conflict.controller');

const {
  protect,
  authorize,
} = require('../middleware/auth.middleware');

const upload =
  require('../middleware/upload.middleware');

const router = express.Router();

/*
 * CREATE REPORT
 *
 * Community Member only.
 * 0 - 5 evidence images.
 */
router.post(
  '/',
  protect,
  authorize('COMMUNITY_MEMBER'),
  upload.array('evidence', 5),
  createConflictReport
);

/*
 * COMMUNITY MEMBER - MY REPORTS
 *
 * Keep this ABOVE /:id.
 */
router.get(
  '/my',
  protect,
  authorize('COMMUNITY_MEMBER'),
  getMyConflictReports
);

/*
 * STAFF - ALL REPORTS
 */
router.get(
  '/',
  protect,
  authorize(
    'RANGER',
    'COMMUNITY_LIAISON_OFFICER',
    'PARK_MANAGER',
    'RANGER_SUPERVISOR',
    'ADMIN'
  ),
  getAllConflictReports
);

/*
 * RANGER / CLO RESPONSE
 */
router.patch(
  '/:id/response',
  protect,
  authorize(
    'RANGER',
    'COMMUNITY_LIAISON_OFFICER'
  ),
  updateConflictResponse
);

/*
 * VIEW ONE REPORT
 */
router.get(
  '/:id',
  protect,
  authorize(
    'COMMUNITY_MEMBER',
    'RANGER',
    'COMMUNITY_LIAISON_OFFICER',
    'PARK_MANAGER',
    'RANGER_SUPERVISOR',
    'ADMIN'
  ),
  getConflictReportById
);

module.exports = router;