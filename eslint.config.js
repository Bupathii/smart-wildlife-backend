'use strict';

/**
 * ESLint for the patrol monitoring use case only. The `files` list keeps
 * these rules away from the other modules in this repository.
 */
const js = require('@eslint/js');

const patrolSources = [
  'src/patrol.container.js',
  'src/config/patrol.config.js',
  'src/constants/patrolEnums.js',
  'src/controllers/patrol.controller.js',
  'src/errors/**/*.js',
  'src/gps/**/*.js',
  'src/middleware/patrolError.middleware.js',
  'src/models/Park.js',
  'src/models/Patrol.js',
  'src/models/Ranger.js',
  'src/models/locationPoint.schema.js',
  'src/models/patrolDomain.js',
  'src/repositories/**/*.js',
  'src/routes/patrol.routes.js',
  'src/services/patrol*.js',
  'src/strategies/**/*.js',
  'src/utils/geo.js',
  'src/utils/logger.js',
  'src/utils/patrolSeed.js',
];
const patrolTests = ['tests/patrol.*.js'];

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  process: 'readonly',
  console: 'readonly',
  structuredClone: 'readonly',
};

module.exports = [
  // Files outside the patrol use case are parsed but not judged.
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: [...patrolSources, ...patrolTests],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: patrolSources,
    rules: {
      complexity: ['error', 8],
      'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'max-depth': ['error', 3],
      'no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
    },
  },
  {
    // Configuration and schema files exist to hold numbers.
    files: ['src/config/patrol.config.js'],
    rules: { 'no-magic-numbers': 'off' },
  },
];
