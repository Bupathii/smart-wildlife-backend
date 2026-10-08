const IncidentReport = require('../models/IncidentReport');

const {
  uploadBuffer,
  deleteCloudinaryImage,
} = require('../utils/cloudinaryUpload');

/*
 * =====================================================
 * CONSTANTS
 * =====================================================
 */

/** Cloudinary folder for all incident evidence photos. */
const CLOUDINARY_FOLDER = 'wildlife-incident-reports';

/** Valid location source values (mirrors LocationSource enum in class diagram). */
const VALID_LOCATION_SOURCES = ['GPS', 'MANUAL'];

// Private helpers

/**
 * Convert a multipart form-data string value to a number.
 * Returns undefined when the value is absent or non-numeric.
 *
 * @param {string|undefined} value
 * @returns {number|undefined}
 */
function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const number = Number(value);

  return Number.isNaN(number) ? undefined : number;
}

/**
 * Delete already-uploaded Cloudinary images when report
 * creation fails, so orphaned files are not left behind.
 *
 * @param {{ publicId: string }[]} images
 * @returns {Promise<void>}
 */
async function cleanupUploadedEvidence(images) {
  for (const image of images) {
    try {
      await deleteCloudinaryImage(image.publicId);
    } catch (error) {
      console.error('Cloudinary cleanup failed:', error.message);
    }
  }
}

/**
 * Validate the incoming incident report request.
 *
 * Corresponds to `validateIncident(details)` in the sequence diagram.
 * Server never trusts the client (§4). Returns field-level errors so
 * the mobile UI can surface specific messages for E2 (missing fields).
 *
 * Extracted from createIncidentReport to satisfy SRP: this function
 * has one job — decide whether the input is valid or not.
 *
 * @param {object} body         - req.body
 * @param {object[]|null} files - req.files (multer)
 * @returns {{ valid: boolean, missingFields: string[], message: string|null,
 *             parsedLatitude: number|undefined, parsedLongitude: number|undefined }}
 */
function validateIncidentInput(body, files) {
  const {
    incidentType,
    description,
    locationSource,
    latitude,
    longitude,
  } = body;

  const missingFields = [];

  if (!incidentType) missingFields.push('incidentType');
  if (!description?.trim()) missingFields.push('description');
  if (!locationSource) missingFields.push('locationSource');

  const parsedLatitude = parseOptionalNumber(latitude);
  const parsedLongitude = parseOptionalNumber(longitude);

  if (parsedLatitude === undefined) missingFields.push('latitude');
  if (parsedLongitude === undefined) missingFields.push('longitude');

  if (missingFields.length > 0) {
    return {
      valid: false,
      missingFields,
      message: 'Required fields are missing',
      parsedLatitude,
      parsedLongitude,
    };
  }

  /*
   * Individual value checks (only run when all fields are present).
   */
  if (!VALID_LOCATION_SOURCES.includes(locationSource)) {
    return {
      valid: false,
      missingFields: ['locationSource'],
      message: 'locationSource must be GPS or MANUAL',
      parsedLatitude,
      parsedLongitude,
    };
  }

  if (parsedLatitude !== undefined && parsedLongitude === undefined) {
    return {
      valid: false,
      missingFields: ['longitude'],
      message: 'Both latitude and longitude must be provided together',
      parsedLatitude,
      parsedLongitude,
    };
  }

  if (parsedLongitude !== undefined && parsedLatitude === undefined) {
    return {
      valid: false,
      missingFields: ['latitude'],
      message: 'Both latitude and longitude must be provided together',
      parsedLatitude,
      parsedLongitude,
    };
  }

  if (!files || files.length === 0) {
    return {
      valid: false,
      missingFields: ['evidence'],
      message: 'At least one evidence photo is required',
      parsedLatitude,
      parsedLongitude,
    };
  }

  return { valid: true, missingFields: [], message: null, parsedLatitude, parsedLongitude };
}

/*
 * POST /api/incidents — RANGER only.
 *
 * Sequence: validateIncident → uploadEvidence → createIncident/saveIncident.
 * Connectivity and sync are handled by the mobile SyncManager.
 * A duplicate clientIncidentId returns 409 so the SyncManager treats
 * it as "already synchronized" without creating a duplicate.
 */

/**
 * Create a new wildlife / poaching incident report.
 *
 * Required body fields (multipart/form-data):
 *   incidentType      {string}  one of INCIDENT_TYPES
 *   description       {string}  max 1500 chars
 *   locationSource    {string}  GPS | MANUAL
 *   latitude          {number}  -90 to 90
 *   longitude         {number}  -180 to 180
 *
 * Optional body fields:
 *   clientIncidentId  {string}  UUID from mobile client (idempotency key)
 *   severity          {string}  LOW | MEDIUM | HIGH | CRITICAL
 *   locationTimestamp {string}  ISO date of GPS capture
 *
 * Files (multipart field "evidence"): 1–5 images ≤ 5 MB each.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createIncidentReport(req, res, next) {
  const uploadedEvidence = [];

  try {
    /*
     * Step 1 — validateIncident (sequence diagram)
     */
    const validation = validateIncidentInput(req.body, req.files);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
        missingFields: validation.missingFields,
      });
    }

    const { parsedLatitude, parsedLongitude } = validation;

    const {
      clientIncidentId,
      incidentType,
      description,
      locationSource,
      severity,
      locationTimestamp,
    } = req.body;

    /*
     * Step 2 — upload evidence photos to Cloudinary (EvidencePhoto.upload)
     */
    for (const file of req.files) {
      const result = await uploadBuffer(file.buffer, CLOUDINARY_FOLDER);

      uploadedEvidence.push({
        url: result.secure_url,
        publicId: result.public_id,
        originalName: file.originalname,
      });
    }

    /*
     * Step 3 — createIncident / saveIncident (sequence diagram)
     * IncidentReport.create() writes to CentralIncidentDB.
     */
    const report = await IncidentReport.create({
      ranger: req.user._id,

      clientIncidentId: clientIncidentId?.trim() || undefined,

      incidentType,

      description: description.trim(),

      severity: severity || 'MEDIUM',

      location: {
        source: locationSource,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        timestamp: locationTimestamp ? new Date(locationTimestamp) : new Date(),
      },

      evidence: uploadedEvidence,

      incidentStatus: 'SUBMITTED',
    });

    await report.populate({
      path: 'ranger',
      select: 'name email phone role',
    });

    return res.status(201).json({
      success: true,
      message: 'Incident report submitted successfully',
      report,
    });
  } catch (error) {
    /*
     * Clean up Cloudinary evidence if the DB write failed,
     * so no orphaned files remain.
     */
    if (uploadedEvidence.length > 0) {
      await cleanupUploadedEvidence(uploadedEvidence);
    }

    /*
     * Duplicate clientIncidentId → already synchronized.
     * The mobile SyncManager treats 409 as success (idempotency §4).
     */
    if (error.code === 11000 && error.keyPattern?.clientIncidentId) {
      return res.status(409).json({
        success: false,
        message: 'This incident report has already been submitted',
        alreadySynchronized: true,
      });
    }

    /*
     * Mongoose validation errors → field-level response.
     */
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((e) => e.message);

      return res.status(400).json({
        success: false,
        message: messages[0] || 'Invalid report data',
        errors: messages,
      });
    }

    next(error);
  }
}

/*
 * GET /api/incidents/my — RANGER only.
 * Returns the authenticated ranger's reports, newest first, paginated.
 */

/**
 * Return a paginated list of the authenticated ranger's incident reports.
 *
 * Query params:
 *   page  {number} default 1
 *   limit {number} default 20, max 100
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getMyIncidentReports(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20)
    );
    const skip = (page - 1) * limit;

    const [reports, total] = await Promise.all([
      IncidentReport.find({ ranger: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: 'ranger', select: 'name email role' }),

      IncidentReport.countDocuments({ ranger: req.user._id }),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      reports,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createIncidentReport,
  getMyIncidentReports,
};
