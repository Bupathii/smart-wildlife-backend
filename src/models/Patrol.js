'use strict';

const mongoose = require('mongoose');
const locationPointSchema = require('./locationPoint.schema');
const { PatrolStatus } = require('../constants/patrolEnums');
const { EVALUATION } = require('../config/patrol.config');

const MAX_PERCENTAGE = 100;
const percentage = { type: Number, default: 0, min: 0, max: MAX_PERCENTAGE };

const patrolCoverageSchema = new mongoose.Schema(
  {
    coverageId: { type: String, required: true },
    percentage,
    calculatedAt: { type: Date, required: true },
    zoneCoverage: [{ _id: false, zoneId: String, percentage: Number }],
  },
  { _id: false },
);

const patrolEvaluationSchema = new mongoose.Schema(
  {
    evaluationId: { type: String, required: true },
    rating: {
      type: Number,
      required: true,
      min: EVALUATION.MIN_RATING,
      max: EVALUATION.MAX_RATING,
    },
    notes: { type: String, default: '', maxlength: EVALUATION.NOTES_MAX_LENGTH },
    evaluatedBy: { type: String, required: true },
    evaluatedAt: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Patrol owns its track, coverage and evaluation (composition), so they
 * are embedded. Rangers and the route are only referenced by id
 * (association).
 */
const patrolSchema = new mongoose.Schema(
  {
    patrolId: { type: String, required: true, unique: true },
    parkId: { type: String, required: true, index: true },
    rangerIds: {
      type: [String],
      validate: {
        validator: (rangerIds) => rangerIds.length > 0,
        message: 'A patrol needs at least one ranger',
      },
    },
    routeId: { type: String, required: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(PatrolStatus),
      default: PatrolStatus.PLANNED,
      index: true,
    },
    progressPercentage: percentage,
    coveragePercentage: percentage,
    track: { type: [locationPointSchema], default: [] },
    coverage: { type: patrolCoverageSchema, default: null },
    evaluation: { type: patrolEvaluationSchema, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Patrol || mongoose.model('Patrol', patrolSchema);
