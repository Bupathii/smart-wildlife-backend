'use strict';

/**
 * Enumerations from the corrected class diagram. Statuses are only ever
 * referenced through these objects, never as loose strings.
 */
const PatrolStatus = Object.freeze({
  PLANNED: 'PLANNED',
  ACTIVE: 'ACTIVE',
  DELAYED: 'DELAYED',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

const TrackingStatus = Object.freeze({
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
});

const LocationSource = Object.freeze({
  GPS: 'GPS',
  MANUAL: 'MANUAL',
  SYNCHRONIZED: 'SYNCHRONIZED',
});

/** Availability of the external GPS Tracking Service. */
const GpsStatus = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
});

/** Statuses of a patrol that is currently out in the field. */
const IN_PROGRESS_STATUSES = Object.freeze([
  PatrolStatus.ACTIVE,
  PatrolStatus.DELAYED,
  PatrolStatus.ON_HOLD,
]);

module.exports = {
  PatrolStatus,
  TrackingStatus,
  LocationSource,
  GpsStatus,
  IN_PROGRESS_STATUSES,
};
