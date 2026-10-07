'use strict';

/**
 * Shared geometry helpers. Every distance, containment and "how far along
 * the route" calculation in the module goes through this file, so the
 * maths exists exactly once (no duplicate code).
 *
 * A "point" is any object with numeric `latitude` and `longitude`.
 */

const EARTH_RADIUS_KM = 6371;
const DEGREES_IN_HALF_CIRCLE = 180;
const SEGMENT_EPSILON = 1e-9;
const DECIMAL_BASE = 10;

const toRadians = (degrees) => (degrees * Math.PI) / DEGREES_IN_HALF_CIRCLE;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Rounds a number to a fixed number of decimal places.
 * @param {number} value
 * @param {number} [decimals]
 * @returns {number}
 */
function roundTo(value, decimals = 0) {
  const factor = DECIMAL_BASE ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Great-circle distance between two points (Haversine formula).
 * @returns {number} distance in kilometres
 */
function haversineKm(from, to) {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** True when `point` lies on the straight edge between `start` and `end`. */
function isOnSegment(point, start, end) {
  const cross =
    (point.latitude - start.latitude) * (end.longitude - start.longitude) -
    (point.longitude - start.longitude) * (end.latitude - start.latitude);
  if (Math.abs(cross) > SEGMENT_EPSILON) return false;

  const withinLatitude =
    point.latitude >= Math.min(start.latitude, end.latitude) - SEGMENT_EPSILON &&
    point.latitude <= Math.max(start.latitude, end.latitude) + SEGMENT_EPSILON;
  const withinLongitude =
    point.longitude >= Math.min(start.longitude, end.longitude) - SEGMENT_EPSILON &&
    point.longitude <= Math.max(start.longitude, end.longitude) + SEGMENT_EPSILON;

  return withinLatitude && withinLongitude;
}

/** True when a horizontal ray from `point` crosses the edge start→end. */
function rayCrossesEdge(point, start, end) {
  const straddles = start.latitude > point.latitude !== end.latitude > point.latitude;
  if (!straddles) return false;

  const crossingLongitude =
    ((end.longitude - start.longitude) * (point.latitude - start.latitude)) /
      (end.latitude - start.latitude) +
    start.longitude;

  return point.longitude < crossingLongitude;
}

/**
 * Point-in-polygon test (ray casting). A point exactly on the boundary
 * counts as inside.
 * @param {{latitude:number, longitude:number}} point
 * @param {Array<{latitude:number, longitude:number}>} polygon
 * @returns {boolean}
 */
function isPointInPolygon(point, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    if (isOnSegment(point, polygon[j], polygon[i])) return true;
    if (rayCrossesEdge(point, polygon[j], polygon[i])) inside = !inside;
  }

  return inside;
}

/**
 * Running distance at each point of a path: [0, d1, d1+d2, ...].
 * @returns {number[]} kilometres
 */
function cumulativeDistancesKm(points) {
  const distances = [0];

  for (let i = 1; i < points.length; i += 1) {
    distances.push(distances[i - 1] + haversineKm(points[i - 1], points[i]));
  }

  return distances;
}

/** Total length of a path in kilometres (0 for fewer than two points). */
function routeLengthKm(points) {
  if (!points || points.length < 2) return 0;
  return cumulativeDistancesKm(points).at(-1);
}

/** Linear interpolation between two points, `ratio` from 0 to 1. */
function interpolate(start, end, ratio) {
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * ratio,
    longitude: start.longitude + (end.longitude - start.longitude) * ratio,
  };
}

/**
 * The position reached after travelling `distanceKm` along a path.
 * Distances beyond either end are clamped to the first / last point.
 */
function pointAlongRoute(points, distanceKm) {
  const distances = cumulativeDistancesKm(points);
  const target = clamp(distanceKm, 0, distances.at(-1));
  const endIndex = Math.max(
    1,
    distances.findIndex((distance) => distance >= target),
  );
  const segmentLength = distances[endIndex] - distances[endIndex - 1];
  const ratio = segmentLength === 0 ? 0 : (target - distances[endIndex - 1]) / segmentLength;

  return interpolate(points[endIndex - 1], points[endIndex], ratio);
}

/** How far along the segment start→end (0..1) the point projects. */
function projectionRatio(point, start, end) {
  const scale = Math.cos(toRadians(start.latitude));
  const segmentX = (end.longitude - start.longitude) * scale;
  const segmentY = end.latitude - start.latitude;
  const lengthSquared = segmentX ** 2 + segmentY ** 2;
  if (lengthSquared === 0) return 0;

  const pointX = (point.longitude - start.longitude) * scale;
  const pointY = point.latitude - start.latitude;

  return clamp((pointX * segmentX + pointY * segmentY) / lengthSquared, 0, 1);
}

/**
 * Distance travelled along a path at the place closest to `point`.
 * Used for patrol progress and by the GPS simulator.
 * @returns {number} kilometres from the start of the path
 */
function distanceAlongRouteKm(points, point) {
  const distances = cumulativeDistancesKm(points);
  let closest = { offsetKm: Infinity, alongKm: 0 };

  for (let i = 1; i < points.length; i += 1) {
    const ratio = projectionRatio(point, points[i - 1], points[i]);
    const projected = interpolate(points[i - 1], points[i], ratio);
    const offsetKm = haversineKm(point, projected);

    if (offsetKm < closest.offsetKm) {
      const segmentLength = distances[i] - distances[i - 1];
      closest = { offsetKm, alongKm: distances[i - 1] + ratio * segmentLength };
    }
  }

  return closest.alongKm;
}

module.exports = {
  roundTo,
  haversineKm,
  isPointInPolygon,
  cumulativeDistancesKm,
  routeLengthKm,
  pointAlongRoute,
  distanceAlongRouteKm,
};
