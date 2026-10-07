'use strict';

const mongoose = require('mongoose');
const locationPointSchema = require('./locationPoint.schema');
const { TrackingStatus } = require('../constants/patrolEnums');

/**
 * Ranger references its park by id (aggregation in the class diagram):
 * a ranger exists independently of the park.
 */
const rangerSchema = new mongoose.Schema(
  {
    rangerId: { type: String, required: true, unique: true },
    parkId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    rank: { type: String, default: 'Ranger' },
    phoneNumber: { type: String, default: '' },
    trackingStatus: {
      type: String,
      enum: Object.values(TrackingStatus),
      default: TrackingStatus.OFFLINE,
    },
    lastSyncTime: { type: Date, default: null },
    lastKnownLocation: { type: locationPointSchema, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Ranger || mongoose.model('Ranger', rangerSchema);
