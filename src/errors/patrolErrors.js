'use strict';

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * Base class for every error this module raises on purpose. The error
 * middleware turns any AppError into `{ error: { code, message } }`.
 */
class AppError extends Error {
  /**
   * @param {string} message human-readable description
   * @param {{ statusCode?: number, code?: string, fields?: object }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = options.statusCode ?? HTTP_SERVER_ERROR;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.fields = options.fields;
  }
}

/** The requested patrol, ranger or park does not exist. */
class NotFoundError extends AppError {
  constructor(message) {
    super(message, { statusCode: HTTP_NOT_FOUND, code: 'NOT_FOUND' });
  }
}

/** The caller sent invalid input; `fields` maps field name to message. */
class ValidationError extends AppError {
  constructor(message, fields = {}) {
    super(message, {
      statusCode: HTTP_BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      fields,
    });
  }
}

/** The external GPS Tracking Service could not be reached. */
class GpsServiceUnavailableError extends AppError {
  constructor(message = 'GPS Tracking Service is unavailable') {
    super(message, {
      statusCode: HTTP_SERVICE_UNAVAILABLE,
      code: 'GPS_UNAVAILABLE',
    });
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  GpsServiceUnavailableError,
  HTTP_SERVER_ERROR,
};
