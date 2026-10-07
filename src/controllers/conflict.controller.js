const mongoose = require('mongoose');

const ConflictReport = require('../models/ConflictReport');

const {
  uploadBuffer,
  deleteCloudinaryImage,
} = require('../utils/cloudinaryUpload');

const STAFF_ROLES = [
  'RANGER',
  'COMMUNITY_LIAISON_OFFICER',
  'PARK_MANAGER',
  'RANGER_SUPERVISOR',
  'ADMIN',
  'RESEARCHER',
];

const RESPONSE_ROLES = [
  'RANGER',
  'COMMUNITY_LIAISON_OFFICER',
];

const ALLOWED_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'RESPONDING',
  'RESOLVED',
];

const ALLOWED_URGENCY_LEVELS = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
];

/*
 * Prototype duplicate-detection assumptions.
 *
 * Reports are considered potential duplicates when:
 *
 * 1. Same conflict type
 * 2. Submitted within previous 2 hours
 * 3. GPS coordinates are within 2 km
 *
 * OR
 *
 * Manual location text matches.
 *
 * Important:
 * Potential duplicates are still saved.
 */
const DUPLICATE_TIME_WINDOW_HOURS = 2;
const DUPLICATE_DISTANCE_KM = 2;

/*
 * Convert multipart form-data values safely.
 */
function parseOptionalNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return undefined;
  }

  const number = Number(value);

  return Number.isNaN(number)
    ? undefined
    : number;
}

/*
 * Remove uploaded Cloudinary images
 * when report creation fails.
 */
async function cleanupUploadedImages(images) {
  for (const image of images) {
    try {
      await deleteCloudinaryImage(
        image.publicId
      );
    } catch (error) {
      console.error(
        'Cloudinary cleanup failed:',
        error.message
      );
    }
  }
}

/*
 * Convert degrees to radians.
 */
function toRadians(value) {
  return (value * Math.PI) / 180;
}

/*
 * Calculate distance between two GPS points.
 *
 * Uses Haversine formula.
 *
 * Returns distance in kilometres.
 */
function calculateDistanceKm(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const earthRadiusKm = 6371;

  const latitudeDifference =
    toRadians(lat2 - lat1);

  const longitudeDifference =
    toRadians(lon2 - lon1);

  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(longitudeDifference / 2) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return earthRadiusKm * c;
}

/*
 * Normalize manual location text.
 *
 * Example:
 *
 * "Near Village Road"
 * " near   village road "
 *
 * become the same text for comparison.
 */
function normalizeLocationText(value) {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/*
 * =====================================================
 * POTENTIAL DUPLICATE DETECTION
 * =====================================================
 *
 * Returns matched ConflictReport or null.
 *
 * It does NOT reject the new report.
 */
async function findPotentialDuplicate({
  conflictType,
  latitude,
  longitude,
  manualLocation,
}) {
  const timeThreshold = new Date(
    Date.now() -
      DUPLICATE_TIME_WINDOW_HOURS *
        60 *
        60 *
        1000
  );

  /*
   * Only compare recent reports
   * with the same conflict type.
   */
  const recentReports =
    await ConflictReport.find({
      conflictType,
      createdAt: {
        $gte: timeThreshold,
      },
    })
      .sort({
        createdAt: -1,
      })
      .limit(50);

  if (recentReports.length === 0) {
    return null;
  }

  /*
   * GPS based duplicate check.
   */
  const hasNewCoordinates =
    latitude !== undefined &&
    longitude !== undefined;

  if (hasNewCoordinates) {
    let closestReport = null;
    let closestDistance = Infinity;

    for (const report of recentReports) {
      const reportLatitude =
        report.location?.latitude;

      const reportLongitude =
        report.location?.longitude;

      const hasExistingCoordinates =
        reportLatitude !== undefined &&
        reportLatitude !== null &&
        reportLongitude !== undefined &&
        reportLongitude !== null;

      if (!hasExistingCoordinates) {
        continue;
      }

      const distance =
        calculateDistanceKm(
          latitude,
          longitude,
          reportLatitude,
          reportLongitude
        );

      if (
        distance <=
          DUPLICATE_DISTANCE_KM &&
        distance < closestDistance
      ) {
        closestDistance = distance;
        closestReport = report;
      }
    }

    if (closestReport) {
      return closestReport;
    }
  }

  /*
   * Manual location fallback.
   */
  const normalizedNewLocation =
    normalizeLocationText(
      manualLocation
    );

  if (normalizedNewLocation) {
    const matchedReport =
      recentReports.find(
        (report) => {
          const existingLocation =
            normalizeLocationText(
              report.location
                ?.manualLocation
            );

          return (
            existingLocation &&
            existingLocation ===
              normalizedNewLocation
          );
        }
      );

    if (matchedReport) {
      return matchedReport;
    }
  }

  return null;
}

/*
 * =====================================================
 * CREATE CONFLICT REPORT
 *
 * POST /api/conflicts
 *
 * COMMUNITY_MEMBER
 * =====================================================
 */
async function createConflictReport(
  req,
  res,
  next
) {
  const uploadedEvidence = [];

  try {
    const {
      clientReportId,
      conflictType,
      description,
      locationSource,
      latitude,
      longitude,
      manualLocation,
    } = req.body;

    /*
     * ------------------------------
     * Basic validation
     * ------------------------------
     */

    if (!conflictType) {
      return res.status(400).json({
        message:
          'Conflict type is required',
      });
    }

    if (!description?.trim()) {
      return res.status(400).json({
        message:
          'Conflict description is required',
      });
    }

    if (!locationSource) {
      return res.status(400).json({
        message:
          'Location source is required',
      });
    }

    if (
      !['GPS', 'MANUAL'].includes(
        locationSource
      )
    ) {
      return res.status(400).json({
        message:
          'Location source must be GPS or MANUAL',
      });
    }

    const parsedLatitude =
      parseOptionalNumber(latitude);

    const parsedLongitude =
      parseOptionalNumber(longitude);

    const hasLatitude =
      parsedLatitude !== undefined;

    const hasLongitude =
      parsedLongitude !== undefined;

    if (
      hasLatitude !==
      hasLongitude
    ) {
      return res.status(400).json({
        message:
          'Both latitude and longitude must be provided together',
      });
    }

    if (
      locationSource === 'GPS' &&
      (!hasLatitude ||
        !hasLongitude)
    ) {
      return res.status(400).json({
        message:
          'Latitude and longitude are required for GPS location',
      });
    }

    if (
      locationSource === 'MANUAL' &&
      !(
        hasLatitude &&
        hasLongitude
      ) &&
      !manualLocation?.trim()
    ) {
      return res.status(400).json({
        message:
          'Manual location or coordinates are required',
      });
    }

    /*
     * ------------------------------
     * Potential duplicate detection
     * ------------------------------
     *
     * This does NOT stop submission.
     */

    const potentialDuplicate =
      await findPotentialDuplicate({
        conflictType,

        latitude:
          parsedLatitude,

        longitude:
          parsedLongitude,

        manualLocation:
          manualLocation?.trim(),
      });

    /*
     * ------------------------------
     * Multiple optional evidence
     * ------------------------------
     *
     * 0 - 5 images.
     */

    if (
      req.files &&
      req.files.length > 0
    ) {
      for (const file of req.files) {
        const result =
          await uploadBuffer(
            file.buffer,
            'wildlife-conflict-reports'
          );

        uploadedEvidence.push({
          url: result.secure_url,

          publicId:
            result.public_id,

          originalName:
            file.originalname,
        });
      }
    }

    /*
     * ------------------------------
     * Save new report
     * ------------------------------
     */

    const report =
      await ConflictReport.create({
        reporter:
          req.user._id,

        clientReportId:
          clientReportId?.trim() ||
          undefined,

        conflictType,

        description:
          description.trim(),

        reportingChannel:
          'MOBILE_APP',

        location: {
          source:
            locationSource,

          latitude:
            parsedLatitude,

          longitude:
            parsedLongitude,

          manualLocation:
            manualLocation?.trim() ||
            undefined,
        },

        evidence:
          uploadedEvidence,

        status:
          'SUBMITTED',

        urgencyLevel:
          'MEDIUM',

        /*
         * Important:
         *
         * Duplicate reports are NOT rejected.
         *
         * They are flagged and linked.
         */
        duplicateInfo: {
          isPotentialDuplicate:
            Boolean(
              potentialDuplicate
            ),

          duplicateOf:
            potentialDuplicate?._id ||
            null,
        },
      });

    await report.populate([
      {
        path: 'reporter',
        select:
          'name email phone role',
      },
      {
        path:
          'duplicateInfo.duplicateOf',
        select:
          'conflictType status createdAt location',
      },
    ]);

    /*
     * Response message is slightly
     * different when a potential
     * duplicate was found.
     */

    return res.status(201).json({
      success: true,

      message:
        potentialDuplicate
          ? 'Conflict report submitted successfully and flagged as a potential duplicate'
          : 'Human-wildlife conflict report submitted successfully',

      potentialDuplicate:
        Boolean(
          potentialDuplicate
        ),

      report,
    });
  } catch (error) {
    /*
     * Remove already uploaded evidence
     * if database creation fails.
     */

    if (
      uploadedEvidence.length > 0
    ) {
      await cleanupUploadedImages(
        uploadedEvidence
      );
    }

    /*
     * clientReportId duplicate means
     * exact same mobile submission
     * has already been synced.
     *
     * This is different from potential
     * conflict duplicate detection.
     */

    if (
      error.code === 11000 &&
      error.keyPattern
        ?.clientReportId
    ) {
      return res.status(409).json({
        message:
          'This report has already been submitted',
      });
    }

    if (
      error.name ===
      'ValidationError'
    ) {
      const firstError =
        Object.values(
          error.errors
        )[0];

      return res.status(400).json({
        message:
          firstError?.message ||
          'Invalid report data',
      });
    }

    next(error);
  }
}

/*
 * =====================================================
 * COMMUNITY MEMBER - MY REPORTS
 *
 * GET /api/conflicts/my
 * =====================================================
 */
async function getMyConflictReports(
  req,
  res,
  next
) {
  try {
    const query = {
      reporter:
        req.user._id,
    };

    if (req.query.status) {
      if (
        !ALLOWED_STATUSES.includes(
          req.query.status
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid report status',
        });
      }

      query.status =
        req.query.status;
    }

    const reports =
      await ConflictReport.find(
        query
      )
        .populate({
          path:
            'duplicateInfo.duplicateOf',
          select:
            'conflictType status createdAt',
        })
        .sort({
          createdAt: -1,
        });

    return res.status(200).json({
      success: true,

      count:
        reports.length,

      reports,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * =====================================================
 * STAFF - ALL REPORTS
 *
 * GET /api/conflicts
 * =====================================================
 */
async function getAllConflictReports(
  req,
  res,
  next
) {
  try {
    const {
      status,
      conflictType,
      urgencyLevel,
      duplicate,
      page = 1,
      limit = 10,
    } = req.query;

    const query = {};

    /*
     * Status filter.
     */
    if (status) {
      if (
        !ALLOWED_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid report status',
        });
      }

      query.status = status;
    }

    /*
     * Conflict type filter.
     */
    if (conflictType) {
      query.conflictType =
        conflictType;
    }

    /*
     * Urgency filter.
     */
    if (urgencyLevel) {
      if (
        !ALLOWED_URGENCY_LEVELS.includes(
          urgencyLevel
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid urgency level',
        });
      }

      query.urgencyLevel =
        urgencyLevel;
    }

    /*
     * Duplicate filter.
     *
     * Example:
     *
     * ?duplicate=true
     */
    if (
      duplicate === 'true'
    ) {
      query[
        'duplicateInfo.isPotentialDuplicate'
      ] = true;
    }

    if (
      duplicate === 'false'
    ) {
      query[
        'duplicateInfo.isPotentialDuplicate'
      ] = false;
    }

    /*
     * Pagination.
     */

    const pageNumber =
      Math.max(
        Number.parseInt(
          page,
          10
        ) || 1,
        1
      );

    const pageLimit =
      Math.min(
        Math.max(
          Number.parseInt(
            limit,
            10
          ) || 10,
          1
        ),
        50
      );

    const skip =
      (pageNumber - 1) *
      pageLimit;

    const [
      reports,
      totalReports,
    ] = await Promise.all([
      ConflictReport.find(
        query
      )
        .populate(
          'reporter',
          'name email phone role'
        )
        .populate(
          'assignedTo',
          'name email role'
        )
        .populate({
          path:
            'duplicateInfo.duplicateOf',
          select:
            'conflictType status createdAt location',
        })
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(pageLimit),

      ConflictReport.countDocuments(
        query
      ),
    ]);

    return res.status(200).json({
      success: true,

      pagination: {
        page:
          pageNumber,

        limit:
          pageLimit,

        totalReports,

        totalPages:
          Math.ceil(
            totalReports /
              pageLimit
          ),
      },

      reports,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * =====================================================
 * GET ONE REPORT
 *
 * GET /api/conflicts/:id
 * =====================================================
 */
async function getConflictReportById(
  req,
  res,
  next
) {
  try {
    const { id } =
      req.params;

    if (
      !mongoose.isValidObjectId(
        id
      )
    ) {
      return res.status(400).json({
        message:
          'Invalid report ID',
      });
    }

    const report =
      await ConflictReport.findById(
        id
      )
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
          'conflictType description status urgencyLevel location evidence createdAt'
        );

    if (!report) {
      return res.status(404).json({
        message:
          'Conflict report not found',
      });
    }

    /*
     * Community Member:
     * only own reports.
     */

    if (
      req.user.role ===
      'COMMUNITY_MEMBER'
    ) {
      const reporterId =
        report.reporter?._id
          ?.toString();

      if (
        reporterId !==
        req.user._id.toString()
      ) {
        return res.status(403).json({
          message:
            'You are not allowed to view this report',
        });
      }
    } else if (
      !STAFF_ROLES.includes(
        req.user.role
      )
    ) {
      return res.status(403).json({
        message:
          'You are not allowed to view this report',
      });
    }

    return res.status(200).json({
      success: true,
      report,
    });
  } catch (error) {
    next(error);
  }
}

/*
 * =====================================================
 * RANGER / CLO RESPONSE
 *
 * PATCH /api/conflicts/:id/response
 * =====================================================
 */
async function updateConflictResponse(
  req,
  res,
  next
) {
  try {
    const { id } =
      req.params;

    const {
      status,
      urgencyLevel,
      responseNote,
    } = req.body;

    if (
      !mongoose.isValidObjectId(
        id
      )
    ) {
      return res.status(400).json({
        message:
          'Invalid report ID',
      });
    }

    if (
      !RESPONSE_ROLES.includes(
        req.user.role
      )
    ) {
      return res.status(403).json({
        message:
          'Only Rangers and Community Liaison Officers can respond to conflict reports',
      });
    }

    const report =
      await ConflictReport.findById(
        id
      );

    if (!report) {
      return res.status(404).json({
        message:
          'Conflict report not found',
      });
    }

    /*
     * Update status.
     */
    if (status) {
      if (
        !ALLOWED_STATUSES.includes(
          status
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid report status',
        });
      }

      if (
        status ===
        'SUBMITTED'
      ) {
        return res.status(400).json({
          message:
            'Report cannot be changed back to SUBMITTED',
        });
      }

      report.status =
        status;
    }

    /*
     * Update urgency.
     */
    if (urgencyLevel) {
      if (
        !ALLOWED_URGENCY_LEVELS.includes(
          urgencyLevel
        )
      ) {
        return res.status(400).json({
          message:
            'Invalid urgency level',
        });
      }

      report.urgencyLevel =
        urgencyLevel;
    }

    /*
     * Automatically assign first
     * Ranger/CLO who handles report.
     */
    if (
      !report.assignedTo
    ) {
      report.assignedTo =
        req.user._id;
    }

    /*
     * Optional response note.
     */
    if (
      responseNote !==
      undefined
    ) {
      const cleanNote =
        responseNote.trim();

      if (!cleanNote) {
        return res.status(400).json({
          message:
            'Response note cannot be empty',
        });
      }

      report.response = {
        note:
          cleanNote,

        respondedBy:
          req.user._id,

        respondedAt:
          new Date(),
      };
    }

    await report.save();

    await report.populate([
      {
        path: 'reporter',
        select:
          'name email phone role',
      },
      {
        path: 'assignedTo',
        select:
          'name email role',
      },
      {
        path:
          'response.respondedBy',
        select:
          'name email role',
      },
      {
        path:
          'duplicateInfo.duplicateOf',
        select:
          'conflictType status createdAt location',
      },
    ]);

    return res.status(200).json({
      success: true,

      message:
        'Conflict report updated successfully',

      report,
    });
  } catch (error) {
    if (
      error.name ===
      'ValidationError'
    ) {
      const firstError =
        Object.values(
          error.errors
        )[0];

      return res.status(400).json({
        message:
          firstError?.message ||
          'Invalid report data',
      });
    }

    next(error);
  }
}

module.exports = {
  createConflictReport,
  getMyConflictReports,
  getAllConflictReports,
  getConflictReportById,
  updateConflictResponse,
};