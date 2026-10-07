'use strict';

const express = require('express');
const { asyncHandler } = require('../middleware/patrolError.middleware');

/**
 * Builds the routers for patrol monitoring. Each router ends with the
 * patrol error handler, so errors raised here never reach (or depend on)
 * the other modules' error handling.
 *
 * @param {object} deps
 * @param {object} deps.controller result of createPatrolController()
 * @param {import('express').ErrorRequestHandler} deps.errorHandler
 * @param {{ view?: Function[], evaluate?: Function[], manage?: Function[] }} [deps.guards]
 *        optional middleware run before viewing / saving an evaluation / changing routes
 * @returns {{ patrols: import('express').Router, parks: import('express').Router, rangers: import('express').Router }}
 */
function createPatrolRouters({ controller, errorHandler, guards = {} }) {
  const view = guards.view ?? [];
  const evaluate = guards.evaluate ?? view;
  const manage = guards.manage ?? evaluate;

  const patrols = express.Router();
  // Fixed paths are registered before "/:patrolId" so they are not captured by it.
  patrols.get('/monitoring', view, asyncHandler(controller.getMonitoringDashboard));
  patrols.get('/completed', view, asyncHandler(controller.getCompletedHistory));
  patrols.get('/', view, asyncHandler(controller.listPatrols));
  patrols.get('/:patrolId', view, asyncHandler(controller.getPatrolDetails));
  patrols.get('/:patrolId/coverage', view, asyncHandler(controller.getPatrolCoverage));
  patrols.put('/:patrolId/evaluation', evaluate, asyncHandler(controller.recordEvaluation));
  patrols.use(errorHandler);

  const parks = express.Router();
  parks.get('/:parkId/zones', view, asyncHandler(controller.getParkMap));
  parks.get('/:parkId/routes', view, asyncHandler(controller.listRoutes));
  parks.post('/:parkId/routes', manage, asyncHandler(controller.createRoute));
  parks.put('/:parkId/routes/:routeId', manage, asyncHandler(controller.updateRoute));
  parks.delete('/:parkId/routes/:routeId', manage, asyncHandler(controller.deleteRoute));
  parks.use(errorHandler);

  const rangers = express.Router();
  rangers.get('/', view, asyncHandler(controller.listRangers));
  rangers.get('/:rangerId/location', view, asyncHandler(controller.getRangerLocation));
  rangers.use(errorHandler);

  return { patrols, parks, rangers };
}

module.exports = { createPatrolRouters };
