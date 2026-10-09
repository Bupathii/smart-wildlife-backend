'use strict';

/** Services for AF4 Record Patrol Evaluation (and EX5 invalid input). */

const { PatrolStatus } = require('../constants/patrolEnums');
const { NotFoundError, ValidationError } = require('../errors/patrolErrors');
const { PatrolEvaluation } = require('../models/patrolDomain');

/**
 * SOLID-S: validation only. It builds a PatrolEvaluation from raw input
 * and reports every problem at once; it never stores anything.
 */
class EvaluationValidator {
  /**
   * @param {{ evaluationId: string, rating: *, notes?: *, evaluatedBy: *, evaluatedAt: Date }} input
   * @returns {PatrolEvaluation} a valid evaluation
   * @throws {ValidationError} with one message per invalid field
   */
  assertValid(input) {
    const evaluation = new PatrolEvaluation({ ...input, notes: input.notes ?? '' });
    const fieldErrors = evaluation.validate();

    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError('Evaluation is not valid', fieldErrors);
    }
    return evaluation;
  }
}

/**
 * SOLID-S: records a Park Manager's evaluation of a patrol.
 * SOLID-I: depends on two small contracts - PatrolReader to find the
 * patrol and EvaluationWriter to store the result - not on a full
 * repository.
 * SOLID-D: the repository contracts, validator and clock are injected.
 */
class PatrolEvaluationService {
  /**
   * @param {object} deps
   * @param {import('../repositories/patrolContracts').PatrolReader} deps.patrolReader
   * @param {import('../repositories/patrolContracts').EvaluationWriter} deps.evaluationWriter
   * @param {EvaluationValidator} deps.validator
   * @param {() => Date} deps.clock
   */
  constructor({ patrolReader, evaluationWriter, validator, clock }) {
    this.patrolReader = patrolReader;
    this.evaluationWriter = evaluationWriter;
    this.validator = validator;
    this.clock = clock;
  }

  /**
   * Saves the evaluation. A patrol has at most one, so saving again
   * updates the existing evaluation instead of adding a second.
   * @param {string} patrolId
   * @param {{ rating: number, notes?: string, evaluatedBy: string }} input
   * @returns {Promise<{ patrolId: string, updated: boolean, evaluation: object }>}
   * @throws {NotFoundError} when the patrol does not exist
   * @throws {ValidationError} when the patrol is not COMPLETED or the input is invalid
   */
  async recordEvaluation(patrolId, input = {}) {
    const patrol = await this.patrolReader.findByPatrolId(patrolId);
    if (!patrol) throw new NotFoundError(`Patrol ${patrolId} was not found`);
    if (patrol.status !== PatrolStatus.COMPLETED) {
      throw new ValidationError('Evaluation available after the patrol is completed', {
        status: 'Only completed patrols can be evaluated',
      });
    }

    const evaluation = this.validator.assertValid({
      evaluationId: patrol.evaluation?.evaluationId ?? `EV-${patrolId}`,
      rating: input.rating,
      notes: input.notes,
      evaluatedBy: input.evaluatedBy,
      evaluatedAt: this.clock(),
    });
    const saved = await this.evaluationWriter.saveEvaluation(patrolId, evaluation.toJSON());

    return { patrolId, updated: Boolean(patrol.evaluation), evaluation: saved };
  }
}

module.exports = { EvaluationValidator, PatrolEvaluationService };
