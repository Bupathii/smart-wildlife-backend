'use strict';

/**
 * Repository contracts ("interfaces" written as abstract classes, because
 * JavaScript has no interface keyword).
 *
 * SOLID-I: instead of one large PatrolRepository interface there are small
 * role-based contracts. A service declares only the contract it needs:
 * PatrolMonitoringService reads patrols and never sees saveEvaluation();
 * PatrolEvaluationService is the only one handed an EvaluationWriter.
 */

/** Used by every abstract method so a missing override fails loudly. */
function notImplemented(contract, method) {
  return new Error(`${contract}.${method}() is not implemented`);
}

/** Read-only access to patrols. */
class PatrolReader {
  /** @returns {Promise<object|null>} */
  async findByPatrolId() {
    throw notImplemented('PatrolReader', 'findByPatrolId');
  }

  /** @returns {Promise<object[]>} patrols that are ACTIVE, DELAYED or ON_HOLD */
  async findInProgress() {
    throw notImplemented('PatrolReader', 'findInProgress');
  }

  /** @returns {Promise<object[]>} COMPLETED patrols, newest first */
  async findCompleted() {
    throw notImplemented('PatrolReader', 'findCompleted');
  }

  /** @returns {Promise<object[]>} COMPLETED patrols that ended on or after `since` */
  async findCompletedSince() {
    throw notImplemented('PatrolReader', 'findCompletedSince');
  }

  /** @returns {Promise<object[]>} patrols matching the filter criteria */
  async findByCriteria() {
    throw notImplemented('PatrolReader', 'findByCriteria');
  }
}

/** Stores the single evaluation of a patrol. */
class EvaluationWriter {
  /** @returns {Promise<object>} the stored evaluation */
  async saveEvaluation() {
    throw notImplemented('EvaluationWriter', 'saveEvaluation');
  }
}

/** Appends newly received locations to a patrol's track. */
class TrackWriter {
  /** @returns {Promise<void>} */
  async appendTrackPoint() {
    throw notImplemented('TrackWriter', 'appendTrackPoint');
  }
}

/** Read-only access to rangers. */
class RangerReader {
  /** @returns {Promise<object[]>} */
  async findAll() {
    throw notImplemented('RangerReader', 'findAll');
  }

  /** @returns {Promise<object|null>} */
  async findByRangerId() {
    throw notImplemented('RangerReader', 'findByRangerId');
  }

  /** @returns {Promise<object[]>} */
  async findByRangerIds() {
    throw notImplemented('RangerReader', 'findByRangerIds');
  }
}

/** Stores a ranger's tracking status and last known location. */
class RangerTrackingWriter {
  /** @returns {Promise<void>} */
  async updateTracking() {
    throw notImplemented('RangerTrackingWriter', 'updateTracking');
  }
}

/** Read-only access to parks. */
class ParkReader {
  /** @returns {Promise<object|null>} */
  async findByParkId() {
    throw notImplemented('ParkReader', 'findByParkId');
  }
}

/** Read-only access to zones. */
class ZoneReader {
  /** @returns {Promise<import('../models/patrolDomain').Zone[]>} */
  async findAll() {
    throw notImplemented('ZoneReader', 'findAll');
  }

  /** @returns {Promise<import('../models/patrolDomain').Zone[]>} */
  async findByParkId() {
    throw notImplemented('ZoneReader', 'findByParkId');
  }
}

/** Read-only access to patrol routes. */
class RouteReader {
  /** @returns {Promise<object[]>} */
  async findAll() {
    throw notImplemented('RouteReader', 'findAll');
  }

  /** @returns {Promise<object[]>} */
  async findByParkId() {
    throw notImplemented('RouteReader', 'findByParkId');
  }

  /** @returns {Promise<object|null>} */
  async findByRouteId() {
    throw notImplemented('RouteReader', 'findByRouteId');
  }
}

/** Creates, changes and removes patrol routes. */
class RouteWriter {
  /** @returns {Promise<void>} */
  async createRoute() {
    throw notImplemented('RouteWriter', 'createRoute');
  }

  /** @returns {Promise<void>} */
  async updateRoute() {
    throw notImplemented('RouteWriter', 'updateRoute');
  }

  /** @returns {Promise<void>} */
  async deleteRoute() {
    throw notImplemented('RouteWriter', 'deleteRoute');
  }
}

module.exports = {
  PatrolReader,
  EvaluationWriter,
  TrackWriter,
  RangerReader,
  RangerTrackingWriter,
  ParkReader,
  ZoneReader,
  RouteReader,
  RouteWriter,
};
