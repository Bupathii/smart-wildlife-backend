const ConflictReport =
  require('../models/ConflictReport');

const {
  v2: cloudinary,
} = require('cloudinary');

/*
 * =====================================================
 * CLOUDINARY CONFIG
 * =====================================================
 */
cloudinary.config({
  cloud_name:
    process.env.CLOUDINARY_CLOUD_NAME,

  api_key:
    process.env.CLOUDINARY_API_KEY,

  api_secret:
    process.env.CLOUDINARY_API_SECRET,
});

/*
 * =====================================================
 * COMMON POPULATE
 * =====================================================
 */
function populateConflictReport(
  query
) {
  return query
    .populate(
      'reporter',
      'name email phone role'
    )
    .populate(
      'assignedTo',
      'name email role'
    )
    .populate(
      'response.respondedBy',
      'name email role'
    )
    .populate(
      'duplicateInfo.duplicateOf',
      'conflictType status createdAt'
    )
    .populate(
      'archiveInfo.archivedBy',
      'name email role'
    )
    .populate(
      'archiveInfo.restoredBy',
      'name email role'
    );
}

/*
 * =====================================================
 * ADMIN - GET ARCHIVED REPORTS
 *
 * GET /api/conflicts/admin/archived
 * =====================================================
 */
async function getArchivedConflictReports(
  req,
  res
) {
  try {
    const page =
      Math.max(
        Number(
          req.query.page
        ) || 1,
        1
      );

    const limit =
      Math.min(
        Math.max(
          Number(
            req.query.limit
          ) || 10,
          1
        ),
        100
      );

    const filter = {
      'archiveInfo.isArchived':
        true,
    };

    if (req.query.status) {
      filter.status =
        req.query.status;
    }

    if (
      req.query.conflictType
    ) {
      filter.conflictType =
        req.query.conflictType;
    }

    if (
      req.query.urgency
    ) {
      filter.urgencyLevel =
        req.query.urgency;
    }

    const skip =
      (page - 1) * limit;

    let query =
      ConflictReport.find(
        filter
      )
        .withArchived()
        .sort({
          'archiveInfo.archivedAt':
            -1,
        })
        .skip(skip)
        .limit(limit);

    query =
      populateConflictReport(
        query
      );

    const reports =
      await query;

    const totalReports =
      await ConflictReport.countDocuments(
        filter
      );

    const totalPages =
      Math.max(
        Math.ceil(
          totalReports / limit
        ),
        1
      );

    return res.json({
      success: true,

      pagination: {
        page,
        limit,
        totalReports,
        totalPages,
      },

      reports,
    });
  } catch (error) {
    console.error(
      'Get archived conflicts error:',
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          'Unable to load archived conflict reports',
      });
  }
}

/*
 * =====================================================
 * ADMIN - GET ACTIVE OR ARCHIVED REPORT
 *
 * GET /api/conflicts/admin/:id
 * =====================================================
 */
async function getAdminConflictReportById(
  req,
  res
) {
  try {
    let query =
      ConflictReport.findById(
        req.params.id
      ).withArchived();

    query =
      populateConflictReport(
        query
      );

    const report =
      await query;

    if (!report) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            'Conflict report not found',
        });
    }

    return res.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error(
      'Get admin conflict error:',
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          'Unable to load conflict report',
      });
  }
}

/*
 * =====================================================
 * ADMIN - ARCHIVE REPORT
 *
 * PATCH /api/conflicts/:id/archive
 *
 * Body:
 * {
 *   "reason": "Invalid test report"
 * }
 * =====================================================
 */
async function archiveConflictReport(
  req,
  res
) {
  try {
    const reason =
      String(
        req.body.reason || ''
      ).trim();

    if (
      reason.length < 3
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            'Please provide a valid archive reason',
        });
    }

    if (
      reason.length > 300
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            'Archive reason cannot exceed 300 characters',
        });
    }

    const report =
      await ConflictReport.findById(
        req.params.id
      ).withArchived();

    if (!report) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            'Conflict report not found',
        });
    }

    if (
      report.archiveInfo
        ?.isArchived
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            'Conflict report is already archived',
        });
    }

    report.archiveInfo = {
      ...report.archiveInfo,

      isArchived: true,

      reason,

      archivedAt:
        new Date(),

      archivedBy:
        req.user._id,

      restoredAt: null,

      restoredBy: null,
    };

    await report.save();

    let updatedQuery =
      ConflictReport.findById(
        report._id
      ).withArchived();

    updatedQuery =
      populateConflictReport(
        updatedQuery
      );

    const updatedReport =
      await updatedQuery;

    return res.json({
      success: true,

      message:
        'Conflict report archived successfully',

      report:
        updatedReport,
    });
  } catch (error) {
    console.error(
      'Archive conflict error:',
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          'Unable to archive conflict report',
      });
  }
}

/*
 * =====================================================
 * ADMIN - RESTORE REPORT
 *
 * PATCH /api/conflicts/:id/restore
 * =====================================================
 */
async function restoreConflictReport(
  req,
  res
) {
  try {
    const report =
      await ConflictReport.findById(
        req.params.id
      ).withArchived();

    if (!report) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            'Conflict report not found',
        });
    }

    if (
      !report.archiveInfo
        ?.isArchived
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            'Conflict report is not archived',
        });
    }

    report.archiveInfo.isArchived =
      false;

    report.archiveInfo.restoredAt =
      new Date();

    report.archiveInfo.restoredBy =
      req.user._id;

    await report.save();

    let updatedQuery =
      ConflictReport.findById(
        report._id
      ).withArchived();

    updatedQuery =
      populateConflictReport(
        updatedQuery
      );

    const updatedReport =
      await updatedQuery;

    return res.json({
      success: true,

      message:
        'Conflict report restored successfully',

      report:
        updatedReport,
    });
  } catch (error) {
    console.error(
      'Restore conflict error:',
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          'Unable to restore conflict report',
      });
  }
}

/*
 * =====================================================
 * ADMIN - PERMANENT DELETE
 *
 * DELETE /api/conflicts/:id/permanent
 *
 * IMPORTANT:
 * Report MUST already be archived.
 *
 * This deletes:
 * 1. Cloudinary evidence
 * 2. MongoDB conflict report
 * =====================================================
 */
async function permanentlyDeleteConflictReport(
  req,
  res
) {
  try {
    const report =
      await ConflictReport.findById(
        req.params.id
      ).withArchived();

    if (!report) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            'Conflict report not found',
        });
    }

    /*
     * Safety rule:
     * Active reports cannot be
     * permanently deleted.
     */
    if (
      !report.archiveInfo
        ?.isArchived
    ) {
      return res
        .status(400)
        .json({
          success: false,

          message:
            'The report must be archived before permanent deletion',
        });
    }

    /*
     * =================================================
     * DELETE CLOUDINARY EVIDENCE
     * =================================================
     */
    const publicIds =
      (report.evidence || [])
        .map(
          (item) =>
            item.publicId
        )
        .filter(Boolean);

    if (
      publicIds.length > 0
    ) {
      const deleteResults =
        await Promise.allSettled(
          publicIds.map(
            (publicId) =>
              cloudinary.uploader.destroy(
                publicId,
                {
                  resource_type:
                    'image',
                  invalidate:
                    true,
                }
              )
          )
        );

      /*
       * If Cloudinary deletion fails,
       * do not permanently delete
       * database data.
       *
       * This prevents orphaned images.
       */
      const failedDeletion =
        deleteResults.find(
          (result) =>
            result.status ===
            'rejected'
        );

      if (
        failedDeletion
      ) {
        console.error(
          'Cloudinary evidence deletion failed:',
          failedDeletion.reason
        );

        return res
          .status(502)
          .json({
            success: false,

            message:
              'Unable to remove supporting evidence. Permanent deletion was cancelled.',
          });
      }
    }

    /*
     * =================================================
     * PERMANENTLY DELETE DATABASE RECORD
     * =================================================
     */
    await ConflictReport.deleteOne({
      _id:
        report._id,
    });

    console.log(
      `Conflict report permanently deleted: ${report._id} by admin ${req.user._id}`
    );

    return res.json({
      success: true,

      message:
        'Conflict report permanently deleted',
    });
  } catch (error) {
    console.error(
      'Permanent conflict delete error:',
      error
    );

    return res
      .status(500)
      .json({
        success: false,

        message:
          'Unable to permanently delete conflict report',
      });
  }
}

module.exports = {
  getArchivedConflictReports,
  getAdminConflictReportById,
  archiveConflictReport,
  restoreConflictReport,
  permanentlyDeleteConflictReport,
};