'use strict';

const { AppError, HTTP_SERVER_ERROR } = require('../errors/patrolErrors');

/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware instead of being lost (Express 4 does not do this itself).
 * @param {(req: object, res: object) => Promise<*>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

/**
 * Central error handling for the patrol monitoring routes (EX4, EX5).
 * Every error is logged with the injected logger and answered with the
 * same clean JSON shape: `{ error: { code, message, fields? } }`.
 *
 * @param {{ error: Function }} logger
 * @returns {import('express').ErrorRequestHandler}
 */
function createPatrolErrorHandler(logger) {
  // Express recognises error middleware by its four parameters.
  return (error, req, res, _next) => {
    logger.error(`${req.method} ${req.originalUrl} failed`, error);

    if (error instanceof AppError) {
      const body = { code: error.code, message: error.message };
      if (error.fields) body.fields = error.fields;
      return res.status(error.statusCode).json({ error: body });
    }

    // Unexpected fault: never leak internal details to the client.
    return res.status(HTTP_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong while loading patrol data. Please try again.',
      },
    });
  };
}

module.exports = { asyncHandler, createPatrolErrorHandler };
