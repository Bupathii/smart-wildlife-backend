const express =
  require('express');

const router =
  express.Router();

const {
  protect,
  authorize,
} =
  require('../middleware/auth.middleware');

const upload =
  require('../middleware/upload.middleware');

const {
  createConflictReport,
  getMyConflictReports,
  getAllConflictReports,
  getConflictReportById,
  updateConflictResponse,
} =
  require('../controllers/conflict.controller');

const {
  getArchivedConflictReports,
  getAdminConflictReportById,
  archiveConflictReport,
  restoreConflictReport,
  permanentlyDeleteConflictReport,
} =
  require('../controllers/conflictArchive.controller');

/*
 * =====================================================
 * ALL ROUTES REQUIRE LOGIN
 * =====================================================
 */
router.use(protect);

/*
 * =====================================================
 * COMMUNITY MEMBER
 * =====================================================
 */

/*
 * Create conflict report
 *
 * POST /api/conflicts
 */
router.post(
  '/',
  authorize(
    'COMMUNITY_MEMBER'
  ),
  upload.array(
    'evidence',
    5
  ),
  createConflictReport
);

/*
 * Community Member own reports
 *
 * GET /api/conflicts/my
 */
router.get(
  '/my',
  authorize(
    'COMMUNITY_MEMBER'
  ),
  getMyConflictReports
);

/*
 * =====================================================
 * ADMIN ARCHIVE MANAGEMENT
 *
 * IMPORTANT:
 * Static admin routes must remain
 * above the generic /:id route.
 * =====================================================
 */

/*
 * Archived conflict reports
 *
 * GET /api/conflicts/admin/archived
 */
router.get(
  '/admin/archived',
  authorize(
    'ADMIN'
  ),
  getArchivedConflictReports
);

/*
 * Admin access to active OR archived report
 *
 * GET /api/conflicts/admin/:id
 */
router.get(
  '/admin/:id',
  authorize(
    'ADMIN'
  ),
  getAdminConflictReportById
);

/*
 * =====================================================
 * ADMIN ARCHIVE
 *
 * PATCH /api/conflicts/:id/archive
 * =====================================================
 */
router.patch(
  '/:id/archive',
  authorize(
    'ADMIN'
  ),
  archiveConflictReport
);

/*
 * =====================================================
 * ADMIN RESTORE
 *
 * PATCH /api/conflicts/:id/restore
 * =====================================================
 */
router.patch(
  '/:id/restore',
  authorize(
    'ADMIN'
  ),
  restoreConflictReport
);

/*
 * =====================================================
 * ADMIN PERMANENT DELETE
 *
 * DELETE /api/conflicts/:id/permanent
 *
 * Controller refuses deletion unless
 * report is already archived.
 * =====================================================
 */
router.delete(
  '/:id/permanent',
  authorize(
    'ADMIN'
  ),
  permanentlyDeleteConflictReport
);

/*
 * =====================================================
 * STAFF LIST
 * =====================================================
 */

/*
 * GET /api/conflicts
 *
 * Archived reports are automatically
 * excluded by the ConflictReport model.
 */
router.get(
  '/',
  authorize(
    'RANGER',
    'COMMUNITY_LIAISON_OFFICER',
    'PARK_MANAGER',
    'RANGER_SUPERVISOR',
    'RESEARCHER',
    'ADMIN'
  ),
  getAllConflictReports
);

/*
 * =====================================================
 * SINGLE REPORT
 * =====================================================
 */

router.get(
  '/:id',
  authorize(
    'COMMUNITY_MEMBER',
    'RANGER',
    'COMMUNITY_LIAISON_OFFICER',
    'PARK_MANAGER',
    'RANGER_SUPERVISOR',
    'RESEARCHER',
    'ADMIN'
  ),
  getConflictReportById
);

/*
 * =====================================================
 * RANGER / CLO RESPONSE
 * =====================================================
 */

router.patch(
  '/:id/response',
  authorize(
    'RANGER',
    'COMMUNITY_LIAISON_OFFICER'
  ),
  updateConflictResponse
);

module.exports =
  router;