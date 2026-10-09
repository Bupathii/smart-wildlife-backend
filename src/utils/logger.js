'use strict';

/* eslint-disable no-console -- this is the one place allowed to touch console */

/**
 * Creates the logger that is injected into services and middleware.
 * Classes never call console directly, so tests can pass a silent logger.
 *
 * @param {string} [scope] prefix added to every line
 * @returns {{ info: Function, warn: Function, error: Function }}
 */
function createConsoleLogger(scope = 'patrol') {
  const prefix = `[${scope}]`;

  return {
    info: (message, details = '') => console.info(prefix, message, details),
    warn: (message, details = '') => console.warn(prefix, message, details),
    error: (message, details = '') => console.error(prefix, message, details),
  };
}

module.exports = { createConsoleLogger };
