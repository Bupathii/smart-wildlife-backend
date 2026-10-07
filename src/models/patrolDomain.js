'use strict';

/**
 * Domain classes from the corrected class diagram that carry behaviour:
 * LocationPoint, Zone, PatrolCoverage and PatrolEvaluation.
 * (The Mongoose schemas that store them are in Park.js / Ranger.js / Patrol.js.)
 */

const { LocationSource } = require('../constants/patrolEnums');
const { EVALUATION, PERCENTAGE_DECIMALS } = require('../config/patrol.config');
const { haversineKm, isPointInPolygon, roundTo } = require('../utils/geo');

const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

const isWithin = (value, limit) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/**
 * Value object for a geographic position. Using it instead of loose
 * latitude/longitude numbers avoids the "primitive obsession" smell.
 */
class LocationPoint {
  /**
   * @param {{ latitude: number, longitude: number, timestamp?: Date|string|null, source?: string }} values
   */
  constructor({ latitude, longitude, timestamp = null, source = LocationSource.GPS }) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.timestamp = timestamp ? new Date(timestamp) : null;
    this.source = source;
    Object.freeze(this);
  }

  /**
   * @param {object|null|undefined} raw stored location data
   * @returns {LocationPoint|null} null when there is nothing to convert
   */
  static from(raw) {
    if (!raw) return null;
    return raw instanceof LocationPoint ? raw : new LocationPoint(raw);
  }

  /** @returns {boolean} true when the coordinates are real-world values */
  isValid() {
    return isWithin(this.latitude, MAX_LATITUDE) && isWithin(this.longitude, MAX_LONGITUDE);
  }

  /**
   * @param {{ latitude: number, longitude: number }} other
   * @returns {number} Haversine distance in kilometres
   */
  calculateDistance(other) {
    return haversineKm(this, other);
  }

  /** @returns {object} plain object for storage and JSON responses */
  toJSON() {
    return {
      latitude: this.latitude,
      longitude: this.longitude,
      timestamp: this.timestamp,
      source: this.source,
    };
  }
}

/** A named area of the park. Zones are owned by a Park (composition). */
class Zone {
  /**
   * @param {{ zoneId: string, name: string, boundary: Array<{latitude:number, longitude:number}>, parkId?: string }} values
   */
  constructor({ zoneId, name, boundary, parkId = null }) {
    this.zoneId = zoneId;
    this.name = name;
    this.boundary = boundary;
    this.parkId = parkId;
  }

  /**
   * @param {{ latitude: number, longitude: number }} point
   * @returns {boolean} true when the point is inside or on the boundary
   */
  contains(point) {
    return isPointInPolygon(point, this.boundary);
  }
}

/**
 * Result of a coverage calculation. It only holds and summarises the
 * per-zone numbers; producing them is the job of a CoverageStrategy.
 */
class PatrolCoverage {
  /**
   * @param {{ coverageId: string, calculatedAt: Date, zoneCoverage: Array<{zoneId:string, percentage:number}> }} values
   */
  constructor({ coverageId, calculatedAt, zoneCoverage = [] }) {
    this.coverageId = coverageId;
    this.calculatedAt = calculatedAt;
    this.zoneCoverage = zoneCoverage;
    this.percentage = 0;
  }

  /**
   * Sets and returns the overall percentage: the average of all zones.
   * @returns {number} 0 when there are no zones
   */
  calculateCoverage() {
    if (this.zoneCoverage.length === 0) {
      this.percentage = 0;
      return this.percentage;
    }

    const total = this.zoneCoverage.reduce((sum, zone) => sum + zone.percentage, 0);
    this.percentage = roundTo(total / this.zoneCoverage.length, PERCENTAGE_DECIMALS);
    return this.percentage;
  }

  /**
   * @param {number} threshold minimum acceptable percentage
   * @returns {Array<{zoneId:string, percentage:number}>} zones strictly below it
   */
  identifyUnderPatrolledZones(threshold) {
    return this.zoneCoverage.filter((zone) => zone.percentage < threshold);
  }

  /** @returns {object} plain object for storage and JSON responses */
  toJSON() {
    return {
      coverageId: this.coverageId,
      percentage: this.percentage,
      calculatedAt: this.calculatedAt,
      zoneCoverage: this.zoneCoverage,
    };
  }
}

/** @returns {string|null} problem with the rating, or null when it is fine */
function ratingProblem(rating) {
  if (rating === undefined || rating === null) return 'Rating is required';
  if (!Number.isInteger(rating)) return 'Rating must be a whole number';
  if (rating < EVALUATION.MIN_RATING || rating > EVALUATION.MAX_RATING) {
    return `Rating must be between ${EVALUATION.MIN_RATING} and ${EVALUATION.MAX_RATING}`;
  }
  return null;
}

/** @returns {string|null} problem with the notes, or null when they are fine */
function notesProblem(notes, rating) {
  if (typeof notes !== 'string') return 'Notes must be text';
  if (notes.length > EVALUATION.NOTES_MAX_LENGTH) {
    return `Notes must be ${EVALUATION.NOTES_MAX_LENGTH} characters or fewer`;
  }

  const lowRating = Number.isInteger(rating) && rating <= EVALUATION.NOTES_REQUIRED_AT_OR_BELOW;
  if (lowRating && notes.trim() === '') {
    return `Notes are required when the rating is ${EVALUATION.NOTES_REQUIRED_AT_OR_BELOW} or lower`;
  }
  return null;
}

/** @returns {string|null} problem with the evaluator id, or null when it is fine */
function evaluatorProblem(evaluatedBy) {
  const present = typeof evaluatedBy === 'string' && evaluatedBy.trim() !== '';
  return present ? null : 'Evaluator is required';
}

/**
 * A Park Manager's assessment of one patrol. A Patrol owns at most one
 * (composition 0..1).
 */
class PatrolEvaluation {
  /**
   * @param {{ evaluationId: string, rating: number, notes?: string, evaluatedBy: string, evaluatedAt: Date }} values
   */
  constructor({ evaluationId, rating, notes = '', evaluatedBy, evaluatedAt }) {
    this.evaluationId = evaluationId;
    this.rating = rating;
    this.notes = notes;
    this.evaluatedBy = evaluatedBy;
    this.evaluatedAt = evaluatedAt;
  }

  /**
   * Checks the business rules for an evaluation.
   * @returns {Object<string, string>} field name → message; empty when valid
   */
  validate() {
    const problems = {
      rating: ratingProblem(this.rating),
      notes: notesProblem(this.notes, this.rating),
      evaluatedBy: evaluatorProblem(this.evaluatedBy),
    };

    return Object.fromEntries(Object.entries(problems).filter(([, message]) => message));
  }

  /** @returns {object} plain object for storage and JSON responses */
  toJSON() {
    return {
      evaluationId: this.evaluationId,
      rating: this.rating,
      notes: this.notes.trim(),
      evaluatedBy: this.evaluatedBy,
      evaluatedAt: this.evaluatedAt,
    };
  }
}

module.exports = { LocationPoint, Zone, PatrolCoverage, PatrolEvaluation };
