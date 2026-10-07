'use strict';

/**
 * HTTP layer for "Monitor and Evaluate Ranger Patrol Activities".
 *
 * SOLID-S: controllers only translate HTTP to a service call and back.
 * They hold no business rules, no calculations and no database code.
 * PATTERN-MVC: routes → controller → service → repository.
 */

/** Handlers for the /api/patrols endpoints. */
function patrolHandlers({ monitoringService, queryService, evaluationService }) {
  return {
    /** GET /api/patrols/monitoring */
    async getMonitoringDashboard(req, res) {
      res.json(await monitoringService.getDashboard());
    },

    /** GET /api/patrols?rangerId=&routeId=&status=&from=&to= */
    async listPatrols(req, res) {
      res.json(await queryService.listPatrols(req.query));
    },

    /** GET /api/patrols/completed */
    async getCompletedHistory(req, res) {
      res.json(await queryService.getCompletedHistory());
    },

    /** GET /api/patrols/:patrolId */
    async getPatrolDetails(req, res) {
      res.json(await queryService.getPatrolDetails(req.params.patrolId));
    },

    /** GET /api/patrols/:patrolId/coverage */
    async getPatrolCoverage(req, res) {
      res.json(await queryService.getPatrolCoverage(req.params.patrolId));
    },

    /** PUT /api/patrols/:patrolId/evaluation */
    async recordEvaluation(req, res) {
      const body = req.body ?? {};
      // The host application supplies the current manager when it knows them.
      const evaluatedBy = req.user?.id ?? body.evaluatedBy;
      const input = { rating: body.rating, notes: body.notes, evaluatedBy };

      res.json(await evaluationService.recordEvaluation(req.params.patrolId, input));
    },
  };
}

/** Handlers for the /api/parks and /api/rangers endpoints. */
function referenceHandlers({ referenceService, locationService }) {
  return {
    /** GET /api/parks/:parkId/zones */
    async getParkMap(req, res) {
      res.json(await referenceService.getParkMap(req.params.parkId));
    },

    /** GET /api/rangers */
    async listRangers(req, res) {
      res.json({ rangers: await referenceService.listRangers() });
    },

    /** GET /api/rangers/:rangerId/location (the Retry button for an offline ranger) */
    async getRangerLocation(req, res) {
      res.json(await locationService.locateRanger(req.params.rangerId));
    },
  };
}

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

/** Handlers for managing patrol routes under /api/parks/:parkId/routes. */
function routeHandlers({ routeService }) {
  return {
    /** GET /api/parks/:parkId/routes */
    async listRoutes(req, res) {
      res.json({ routes: await routeService.listRoutes(req.params.parkId) });
    },

    /** POST /api/parks/:parkId/routes */
    async createRoute(req, res) {
      const route = await routeService.createRoute(req.params.parkId, req.body ?? {});
      res.status(HTTP_CREATED).json(route);
    },

    /** PUT /api/parks/:parkId/routes/:routeId */
    async updateRoute(req, res) {
      const { parkId, routeId } = req.params;
      res.json(await routeService.updateRoute(parkId, routeId, req.body ?? {}));
    },

    /** DELETE /api/parks/:parkId/routes/:routeId */
    async deleteRoute(req, res) {
      await routeService.deleteRoute(req.params.parkId, req.params.routeId);
      res.status(HTTP_NO_CONTENT).end();
    },
  };
}

/**
 * @param {object} services
 * @param {object} services.monitoringService PatrolMonitoringService
 * @param {object} services.queryService PatrolQueryService
 * @param {object} services.evaluationService PatrolEvaluationService
 * @param {object} services.locationService RangerLocationService
 * @param {object} services.referenceService PatrolReferenceService
 * @param {object} services.routeService PatrolRouteService
 * @returns {Object<string, (req: object, res: object) => Promise<void>>}
 */
function createPatrolController(services) {
  return {
    ...patrolHandlers(services),
    ...referenceHandlers(services),
    ...routeHandlers(services),
  };
}

module.exports = { createPatrolController };
