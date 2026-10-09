'use strict';

const mongoose = require('mongoose');
const { LocationSource } = require('../constants/patrolEnums');

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

/**
 * Embedded LocationPoint, reused by routes (waypoints), patrols (track)
 * and rangers (lastKnownLocation) so the shape is defined once.
 */
const locationPointSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true, min: -MAX_LATITUDE, max: MAX_LATITUDE },
    longitude: { type: Number, required: true, min: -MAX_LONGITUDE, max: MAX_LONGITUDE },
    timestamp: { type: Date, default: null },
    source: {
      type: String,
      enum: Object.values(LocationSource),
      default: LocationSource.GPS,
    },
  },
  { _id: false },
);

module.exports = locationPointSchema;
