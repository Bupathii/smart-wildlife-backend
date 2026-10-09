'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/patrolError.middleware');

/** Routes under /api/patrols. */
function createPatrolsRouter(controller, guards, errorHandler) {
  const { view, evaluate, manage, ranger } = guards;
  const router = express.Router();

  // Fixed paths are registered before "/:patrolId" so they are not captured by it.
  router.get('/monitoring', view, asyncHandler(controller.getMonitoringDashboard));
  router.get('/completed', view, asyncHandler(controller.getCompletedHistory));
  router.get('/mine', ranger, asyncHandler(controller.getMyPatrol));
  router.post('/mine/start', ranger, asyncHandler(controller.startMyPatrol));
  router.post('/mine/locations', ranger, asyncHandler(controller.recordMyLocations));
  router.post('/mine/complete', ranger, asyncHandler(controller.completeMyPatrol));
  router.get('/', view, asyncHandler(controller.listPatrols));
  router.post('/', manage, asyncHandler(controller.createPatrol));
  router.get('/:patrolId', view, asyncHandler(controller.getPatrolDetails));
  router.get('/:patrolId/coverage', view, asyncHandler(controller.getPatrolCoverage));
  router.put('/:patrolId/evaluation', evaluate, asyncHandler(controller.recordEvaluation));
  router.put('/:patrolId', manage, asyncHandler(controller.updatePatrol));
  router.post('/:patrolId/cancel', manage, asyncHandler(controller.cancelPatrol));
  router.use(errorHandler);

  return router;
}

/** Routes under /api/parks (map data and patrol routes). */
function createParksRouter(controller, guards, errorHandler) {
  const { view, manage } = guards;
  const router = express.Router();

  router.get('/:parkId/zones', view, asyncHandler(controller.getParkMap));
  router.get('/:parkId/routes', view, asyncHandler(controller.listRoutes));
  router.post('/:parkId/routes', manage, asyncHandler(controller.createRoute));
  router.put('/:parkId/routes/:routeId', manage, asyncHandler(controller.updateRoute));
  router.delete('/:parkId/routes/:routeId', manage, asyncHandler(controller.deleteRoute));
  router.use(errorHandler);

  return router;
}

/** Routes under /api/rangers. */
function createRangersRouter(controller, guards, errorHandler) {
  const router = express.Router();

  router.get('/', guards.view, asyncHandler(controller.listRangers));
  router.get('/:rangerId/location', guards.view, asyncHandler(controller.getRangerLocation));
  router.use(errorHandler);

  return router;
}

/**
 * Builds the routers for patrol monitoring. Each router ends with the
 * patrol error handler, so errors raised here never reach (or depend on)
 * the other modules' error handling.
 *
 * @param {object} deps
 * @param {object} deps.controller result of createPatrolController()
 * @param {import('express').ErrorRequestHandler} deps.errorHandler
 * @param {{ view?: Function[], evaluate?: Function[], manage?: Function[], ranger?: Function[] }} [deps.guards]
 *        optional middleware run before viewing / saving an evaluation /
 *        planning patrols and routes / a ranger using their own patrol
 * @returns {{ patrols: import('express').Router, parks: import('express').Router, rangers: import('express').Router }}
 */
function createPatrolRouters({ controller, errorHandler, guards = {} }) {
  const view = guards.view ?? [];
  const evaluate = guards.evaluate ?? view;
  const resolved = {
    view,
    evaluate,
    manage: guards.manage ?? evaluate,
    ranger: guards.ranger ?? view,
  };

  return {
    patrols: createPatrolsRouter(controller, resolved, errorHandler),
    parks: createParksRouter(controller, resolved, errorHandler),
    rangers: createRangersRouter(controller, resolved, errorHandler),
  };
}

module.exports = { createPatrolRouters };
