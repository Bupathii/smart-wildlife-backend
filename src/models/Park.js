'use strict';

const mongoose = require('mongoose');
const locationPointSchema = require('./locationPoint.schema');

const MIN_WAYPOINTS = 2;

const zoneSchema = new mongoose.Schema(
  {
    zoneId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    boundary: { type: [locationPointSchema], required: true },
  },
  { _id: false },
);

const patrolRouteSchema = new mongoose.Schema(
  {
    routeId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    routeLength: { type: Number, required: true, min: 0 },
    waypoints: {
      type: [locationPointSchema],
      validate: {
        validator: (waypoints) => waypoints.length >= MIN_WAYPOINTS,
        message: `A patrol route needs at least ${MIN_WAYPOINTS} waypoints`,
      },
    },
    zoneIds: { type: [String], default: [] },
  },
  { _id: false },
);

/**
 * Park owns its Zones and PatrolRoutes (composition in the class diagram),
 * so both are embedded: they cannot exist without their park.
 */
const parkSchema = new mongoose.Schema(
  {
    parkId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    location: { type: locationPointSchema, required: true },
    terrainType: { type: String, default: '' },
    zones: { type: [zoneSchema], default: [] },
    routes: { type: [patrolRouteSchema], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Park || mongoose.model('Park', parkSchema);
