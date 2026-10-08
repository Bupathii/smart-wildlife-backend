const mongoose = require('mongoose');

// Enums — class diagram §3.4, keep names traceable in code

/** @enum {string} */
const INCIDENT_TYPES = Object.freeze([
  'SNARE',
  'ANIMAL_CARCASS',
  'ILLEGAL_CAMP',
  'ANIMAL_FOOTPRINT',
  'POACHING',
  'OTHER',
]);

/** @enum {string} */
const SEVERITY_LEVELS = Object.freeze([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

/** @enum {string} */
const INCIDENT_STATUSES = Object.freeze([
  'SUBMITTED',
  'UNDER_REVIEW',
  'RESOLVED',
]);

/** @enum {string} — LocationPoint.source */
const LOCATION_SOURCES = Object.freeze([
  'GPS',
  'MANUAL',
]);

// EvidencePhoto sub-document — class diagram: url, publicId, originalName, uploadedAt
const evidencePhotoSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },

    publicId: {
      type: String,
      required: true,
      trim: true,
    },

    originalName: {
      type: String,
      trim: true,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

// LocationPoint sub-document — class diagram: latitude, longitude, timestamp, source (GPS|MANUAL)
const locationPointSchema = new mongoose.Schema(
  {
    source: {
      type: String,
      enum: LOCATION_SOURCES,
      required: true,
    },

    latitude: {
      type: Number,
      required: true,
      min: -90,
      max: 90,
    },

    longitude: {
      type: Number,
      required: true,
      min: -180,
      max: 180,
    },

    /** ISO timestamp of when coordinates were captured. */
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

// IncidentReport schema — extends Report (class diagram); syncStatus lives client-side only
const incidentReportSchema = new mongoose.Schema(
  {
    /*
     * The Ranger who filed the report.
     */
    ranger: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /*
     * Client-generated UUID sent by the mobile app.
     * Enables idempotent re-sends: if the same UUID
     * arrives a second time the server returns 409
     * ("already submitted") which the SyncManager
     * treats as a successful sync.
     */
    clientIncidentId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    /*
     * IncidentReport.incidentType (class diagram)
     */
    incidentType: {
      type: String,
      enum: INCIDENT_TYPES,
      required: true,
      index: true,
    },

    /*
     * Inherited from abstract Report (class diagram).
     */
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1500,
    },

    /*
     * IncidentReport.severity (class diagram)
     */
    severity: {
      type: String,
      enum: SEVERITY_LEVELS,
      default: 'MEDIUM',
      index: true,
    },

    /*
     * IncidentReport.incidentStatus (class diagram)
     */
    incidentStatus: {
      type: String,
      enum: INCIDENT_STATUSES,
      default: 'SUBMITTED',
      index: true,
    },

    /*
     * IncidentReport 1 — 1 LocationPoint (class diagram)
     */
    location: {
      type: locationPointSchema,
      required: true,
    },

    /*
     * IncidentReport composed of 0..* EvidencePhoto
     * At least one photo is required (validated below).
     */
    evidence: {
      type: [evidencePhotoSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Pre-validate: at least one evidence photo required
incidentReportSchema.pre('validate', function (next) {
  if (!this.evidence || this.evidence.length === 0) {
    return next(
      new Error('At least one evidence photo is required')
    );
  }

  next();
});

// Compound indexes for common query patterns
incidentReportSchema.index({ createdAt: -1 });
incidentReportSchema.index({ incidentType: 1, createdAt: -1 });
incidentReportSchema.index({ incidentStatus: 1, createdAt: -1 });

const IncidentReport = mongoose.model(
  'IncidentReport',
  incidentReportSchema
);

module.exports = IncidentReport;
module.exports.INCIDENT_TYPES = INCIDENT_TYPES;
module.exports.SEVERITY_LEVELS = SEVERITY_LEVELS;
module.exports.INCIDENT_STATUSES = INCIDENT_STATUSES;
module.exports.LOCATION_SOURCES = LOCATION_SOURCES;
