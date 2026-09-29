const mongoose = require('mongoose');

const evidenceSchema = new mongoose.Schema(
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
  {
    _id: true,
  }
);

const conflictReportSchema =
  new mongoose.Schema(
    {
      reporter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
      },

      /*
       * Used by mobile/offline synchronization
       * to avoid creating the exact same report
       * more than once.
       */
      clientReportId: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
      },

      conflictType: {
        type: String,
        enum: [
          'ELEPHANT_SIGHTING',
          'CROP_RAIDING',
          'OTHER',
        ],
        required: true,
        index: true,
      },

      description: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1500,
      },

      reportingChannel: {
        type: String,
        enum: [
          'MOBILE_APP',
          'SMS',
        ],
        default: 'MOBILE_APP',
      },

      location: {
        source: {
          type: String,
          enum: [
            'GPS',
            'MANUAL',
          ],
          required: true,
        },

        latitude: {
          type: Number,
          min: -90,
          max: 90,
        },

        longitude: {
          type: Number,
          min: -180,
          max: 180,
        },

        manualLocation: {
          type: String,
          trim: true,
        },
      },

      evidence: {
        type: [
          evidenceSchema,
        ],
        default: [],
      },

      status: {
        type: String,
        enum: [
          'SUBMITTED',
          'UNDER_REVIEW',
          'RESPONDING',
          'RESOLVED',
        ],
        default: 'SUBMITTED',
        index: true,
      },

      urgencyLevel: {
        type: String,
        enum: [
          'LOW',
          'MEDIUM',
          'HIGH',
          'CRITICAL',
        ],
        default: 'MEDIUM',
        index: true,
      },

      duplicateInfo: {
        isPotentialDuplicate: {
          type: Boolean,
          default: false,
        },

        duplicateOf: {
          type:
            mongoose.Schema.Types
              .ObjectId,

          ref:
            'ConflictReport',

          default: null,
        },
      },

      assignedTo: {
        type:
          mongoose.Schema.Types
            .ObjectId,

        ref: 'User',

        default: null,
      },

      response: {
        note: {
          type: String,
          trim: true,
          maxlength: 1000,
          default: '',
        },

        respondedBy: {
          type:
            mongoose.Schema.Types
              .ObjectId,

          ref: 'User',

          default: null,
        },

        respondedAt: {
          type: Date,
          default: null,
        },
      },

      /*
       * ===============================================
       * ADMIN ARCHIVE
       *
       * We do NOT permanently delete conflict reports.
       *
       * Archived records are retained for:
       * - history
       * - auditing
       * - accidental archive recovery
       *
       * Normal application queries automatically
       * exclude archived reports.
       * ===============================================
       */
      archiveInfo: {
        isArchived: {
          type: Boolean,
          default: false,
          index: true,
        },

        reason: {
          type: String,
          trim: true,
          maxlength: 300,
          default: '',
        },

        archivedAt: {
          type: Date,
          default: null,
        },

        archivedBy: {
          type:
            mongoose.Schema.Types
              .ObjectId,

          ref: 'User',

          default: null,
        },

        restoredAt: {
          type: Date,
          default: null,
        },

        restoredBy: {
          type:
            mongoose.Schema.Types
              .ObjectId,

          ref: 'User',

          default: null,
        },
      },
    },
    {
      timestamps: true,
    }
  );

/*
 * =====================================================
 * VALIDATE LOCATION
 * =====================================================
 */
conflictReportSchema.pre(
  'validate',
  function (next) {
    if (
      this.location?.source ===
      'GPS'
    ) {
      const latitudeExists =
        this.location.latitude !==
        undefined &&
        this.location.latitude !==
        null;

      const longitudeExists =
        this.location.longitude !==
        undefined &&
        this.location.longitude !==
        null;

      if (
        !latitudeExists ||
        !longitudeExists
      ) {
        return next(
          new Error(
            'GPS reports require latitude and longitude'
          )
        );
      }
    }

    if (
      this.location?.source ===
      'MANUAL'
    ) {
      const hasManualLocation =
        Boolean(
          this.location
            .manualLocation
            ?.trim()
        );

      const hasCoordinates =
        this.location.latitude !==
          undefined &&
        this.location.latitude !==
          null &&
        this.location.longitude !==
          undefined &&
        this.location.longitude !==
          null;

      if (
        !hasManualLocation &&
        !hasCoordinates
      ) {
        return next(
          new Error(
            'Manual reports require location information'
          )
        );
      }
    }

    next();
  }
);

/*
 * =====================================================
 * QUERY HELPER
 *
 * Special Admin queries can use:
 *
 * ConflictReport.find(...)
 *   .withArchived()
 *
 * =====================================================
 */
conflictReportSchema.query.withArchived =
  function () {
    this._includeArchived = true;

    return this;
  };

/*
 * =====================================================
 * AUTOMATIC ARCHIVE FILTER
 *
 * Normal:
 * ConflictReport.find(...)
 * ConflictReport.findOne(...)
 * ConflictReport.findById(...)
 *
 * automatically hide archived records.
 *
 * Admin query:
 * query.withArchived()
 *
 * can access archived records.
 * =====================================================
 */
conflictReportSchema.pre(
  /^find/,
  function (next) {
    if (
      !this._includeArchived
    ) {
      this.where({
        'archiveInfo.isArchived': {
          $ne: true,
        },
      });
    }

    next();
  }
);

/*
 * Useful indexes
 */
conflictReportSchema.index({
  createdAt: -1,
});

conflictReportSchema.index({
  conflictType: 1,
  createdAt: -1,
});

conflictReportSchema.index({
  status: 1,
  createdAt: -1,
});

module.exports =
  mongoose.model(
    'ConflictReport',
    conflictReportSchema
  );