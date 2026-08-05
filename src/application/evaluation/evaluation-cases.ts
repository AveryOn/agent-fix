import type {
  EvaluationCase,
  EvaluationCaseExecutionResult
} from '~/core/evaluation'
import type { ProcessOperationResult } from '~/core/process'

import { RetryExecutor } from '~/application/execution'
import { ImplementationGate } from '~/application/implementer'
import { ReproductionGate } from '~/application/reproducer'
import { ChangedFilePolicyValidator } from '~/application/validation'
import { ExecutionError, ExecutionErrorCode } from '~/core/execution'
import {
  InvestigatorError,
  InvestigatorErrorCode
} from '~/core/investigation'
import { ProcessOperation } from '~/core/process'
import { ReproducerErrorCode } from '~/core/reproduction'
import { ValidationErrorCode } from '~/core/validation'

const reproductionMarker = 'AGENT_FIX_REPRODUCTION: expected one payment'

export function createEvaluationCases(): readonly EvaluationCase[] {
  return [
    createDuplicatePaymentFixCase(),

    createHallucinatedFileCase(),

    createAlreadyPassingReproductionCase(),

    createTypecheckFailureCase(),

    createForbiddenFileCase(),

    createRetryThenSuccessCase()
  ]
}

function createDuplicatePaymentFixCase(): EvaluationCase {
  return {
    definition: {
      id: 'duplicate-payment-fix',

      name: 'Successful duplicate-payment fix',

      description:
        'The implementation test passes and no reproduction marker remains.',

      expected: {
        classification: 'accepted',
        passed: true,
        attempts: 1,
        errorCode: null
      }
    },

    execute: () => {
      const gate = new ImplementationGate()

      gate.assertReproductionFixed(
        createCommandResult({
          operation: ProcessOperation.run_tests,
          succeeded: true,
          exitCode: 0,
          stdout: '2 tests passed',
          stderr: ''
        }),
        reproductionMarker
      )

      return Promise.resolve({
        classification: 'accepted',
        attempts: 1,
        errorCode: null
      })
    }
  }
}

function createHallucinatedFileCase(): EvaluationCase {
  return {
    definition: {
      id: 'hallucinated-file-reference',

      name: 'Hallucinated file reference',

      description:
        'An investigator result references a file that does not exist.',

      expected: {
        classification: 'hallucinated_file_rejected',

        passed: false,

        attempts: 1,

        errorCode: InvestigatorErrorCode.hallucinated_file
      }
    },

    execute: () => {
      const repositoryFiles = new Set([
        'src/payment-service.ts',
        'src/webhook-handler.ts'
      ])

      const referencedFile = 'src/non-existent-payment-store.ts'

      try {
        if (!repositoryFiles.has(referencedFile)) {
          throw new InvestigatorError(
            `Investigator referenced a missing file: ${referencedFile}`,
            InvestigatorErrorCode.hallucinated_file,
            {
              retryable: true
            }
          )
        }
      } catch (error) {
        if (
          error instanceof InvestigatorError &&
          error.code === InvestigatorErrorCode.hallucinated_file
        ) {
          return Promise.resolve({
            classification: 'hallucinated_file_rejected',

            attempts: 1,

            errorCode: error.code
          })
        }

        throw error
      }

      throw new Error('Hallucinated file reference was accepted')
    }
  }
}

function createAlreadyPassingReproductionCase(): EvaluationCase {
  return {
    definition: {
      id: 'reproduction-test-already-passes',

      name: 'Reproduction test already passes',

      description:
        'The pre-fix reproduction test exits successfully and must be rejected.',

      expected: {
        classification: 'pre_fix_test_pass_rejected',

        passed: false,

        attempts: 1,

        errorCode: ReproducerErrorCode.test_already_passes
      }
    },

    execute: () => {
      const gate = new ReproductionGate()

      try {
        gate.assertExpectedFailure(
          createCommandResult({
            operation: ProcessOperation.run_tests,

            succeeded: true,

            exitCode: 0,

            stdout: 'All tests passed',

            stderr: ''
          }),
          reproductionMarker
        )
      } catch (error) {
        if (isErrorCode(error, ReproducerErrorCode.test_already_passes)) {
          return Promise.resolve({
            classification: 'pre_fix_test_pass_rejected',

            attempts: 1,

            errorCode: ReproducerErrorCode.test_already_passes
          })
        }

        throw error
      }

      throw new Error('Pre-fix passing reproduction test was accepted')
    }
  }
}

function createTypecheckFailureCase(): EvaluationCase {
  return {
    definition: {
      id: 'typecheck-failure',

      name: 'Typecheck failure',

      description:
        'A failed required typecheck prevents validation from passing.',

      expected: {
        classification: 'typecheck_failure_rejected',

        passed: false,

        attempts: 1,

        errorCode: ValidationErrorCode.process_check_failed
      }
    },

    execute: () => {
      const result = createCommandResult({
        operation: ProcessOperation.run_typecheck,

        succeeded: false,

        exitCode: 2,

        stdout: '',

        stderr: 'TS2322: Type string is not assignable to type number'
      })

      if (result.succeeded || result.exitCode === 0) {
        throw new Error('Typecheck fixture unexpectedly passed')
      }

      return Promise.resolve({
        classification: 'typecheck_failure_rejected',

        attempts: 1,

        errorCode: ValidationErrorCode.process_check_failed
      })
    }
  }
}

function createForbiddenFileCase(): EvaluationCase {
  return {
    definition: {
      id: 'forbidden-file-modification',

      name: 'Forbidden file modification',

      description:
        'The implementation changes package.json outside the allowed scope.',

      expected: {
        classification: 'forbidden_file_rejected',

        passed: false,

        attempts: 1,

        errorCode: ValidationErrorCode.changed_file_policy
      }
    },

    execute: () => {
      const validator = new ChangedFilePolicyValidator()

      const violations = validator.getViolations(
        ['src/payment-service.ts', 'package.json'],
        {
          allowedFiles: ['src/payment-service.ts'],

          forbiddenFiles: ['package.json'],

          forbiddenPrefixes: ['.git', 'node_modules']
        }
      )

      if (!violations.includes('package.json')) {
        throw new Error('Forbidden package.json change was accepted')
      }

      return Promise.resolve({
        classification: 'forbidden_file_rejected',

        attempts: 1,

        errorCode: ValidationErrorCode.changed_file_policy
      })
    }
  }
}

function createRetryThenSuccessCase(): EvaluationCase {
  return {
    definition: {
      id: 'retry-then-success',

      name: 'Retry then success',

      description:
        'The first structured output is rejected and the second attempt succeeds.',

      expected: {
        classification: 'accepted_after_retry',

        passed: true,

        attempts: 2,

        errorCode: null
      }
    },

    async execute(): Promise<EvaluationCaseExecutionResult> {
      const retryExecutor = new RetryExecutor(3)

      let attempts = 0

      await retryExecutor.execute({
        operation: () => {
          attempts += 1

          if (attempts === 1) {
            throw new ExecutionError(
              'Structured output did not match the schema',
              ExecutionErrorCode.retry_failed,
              {
                retryable: true
              }
            )
          }

          return Promise.resolve()
        },

        onRetry: () =>
          Promise.resolve(['Return a complete valid JSON object'])
      })

      return {
        classification: 'accepted_after_retry',

        attempts,

        errorCode: null
      }
    }
  }
}

function createCommandResult(
  overrides: Partial<ProcessOperationResult> = {}
): ProcessOperationResult {
  return {
    executionId: 'evaluation-execution-001',

    runId: 'evaluation-run',

    workspaceRevision: 'sha256:evaluation-revision',

    operation: ProcessOperation.run_tests,

    command: {
      executable: 'npm',
      args: ['run', 'test']
    },

    cwd: '/evaluation/workspace',

    startedAt: '2026-08-05T12:00:00.000Z',

    completedAt: '2026-08-05T12:00:01.000Z',

    durationMs: 1000,

    stdout: '',

    stderr: '',

    exitCode: 0,

    signal: null,

    timedOut: false,

    succeeded: true,

    artifact: {
      id: 'evaluation-execution-001',
      type: 'command.result',
      relativePath: 'commands/evaluation-execution-001.json'
    },

    ...overrides
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}
