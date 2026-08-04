/* eslint-disable @typescript-eslint/require-await */
import type { Logger } from '~/core/logging'
import type { ProcessOperationResult, ProcessRunner } from '~/core/process'
import type { TraceRecorder } from '~/core/trace'
import type {
  MechanicalValidationCheck,
  ValidationInput,
  ValidationReportStore,
  ValidationResult,
  ValidationService
} from '~/core/validation'
import type { RepositoryToolsFactory } from '~/core/workspace'

import { ImplementationGate } from '~/application/implementer'
import { ReproductionGate } from '~/application/reproducer'
import { AgentOutputSchemaValidator } from '~/application/validation/agent-output-schema-validator'
import { ChangedFilePolicyValidator } from '~/application/validation/changed-file-policy-validator'
import { EvidenceReferenceValidator } from '~/application/validation/evidence-reference-validator'
import { PatchApplicationValidator } from '~/application/validation/patch-application-validator'
import { TraceEventType } from '~/core/trace'
import {
  mechanicalValidationReportSchema,
  MechanicalValidationCheckStatus,
  ValidationCheckId,
  ValidationError,
  ValidationErrorCode,
  ValidationGateError,
  validationFilePolicySchema
} from '~/core/validation'

const validationStep = 'validation'

const orderedCheckIds = [
  ValidationCheckId.agent_output_schema,
  ValidationCheckId.evidence_references,
  ValidationCheckId.patch_application,
  ValidationCheckId.reproduction_failure,
  ValidationCheckId.reproduction_success,
  ValidationCheckId.full_test_suite,
  ValidationCheckId.typecheck,
  ValidationCheckId.lint,
  ValidationCheckId.build,
  ValidationCheckId.changed_file_policy
] as const

export class DeterministicValidationService implements ValidationService {
  constructor(
    private readonly repositoryToolsFactory: RepositoryToolsFactory,

    private readonly processRunnerFactory: {
      create(workspace: ValidationInput['workspace']): ProcessRunner
    },

    private readonly reportStore: ValidationReportStore,

    private readonly traceRecorder: TraceRecorder,

    private readonly logger: Logger,

    private readonly agentOutputValidator = new AgentOutputSchemaValidator(),

    private readonly evidenceValidator = new EvidenceReferenceValidator(),

    private readonly patchValidator = new PatchApplicationValidator(),

    private readonly reproductionGate = new ReproductionGate(),

    private readonly implementationGate = new ImplementationGate(),

    private readonly changedFilePolicyValidator = new ChangedFilePolicyValidator(),

    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(input: ValidationInput): Promise<ValidationResult> {
    this.assertValidInput(input)

    const logger = this.logger.child({
      runId: input.runId,
      step: validationStep,
      workspaceRevision: input.workspace.workspaceRevision
    })

    const checks: MechanicalValidationCheck[] = []

    let finalDiff = ''
    let changedFiles: readonly string[] = []

    let forbiddenFiles: readonly string[] = []

    const repositoryTools = this.repositoryToolsFactory.create(
      input.workspace
    )

    const schemaPassed = await this.runCheck(
      checks,
      ValidationCheckId.agent_output_schema,
      async () => {
        this.agentOutputValidator.validatePreReview(
          input.investigation,
          input.reproduction,
          input.implementation
        )

        return {
          message:
            'Investigator, reproducer, and implementer outputs match their schemas'
        }
      }
    )

    if (!schemaPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const evidencePassed = await this.runCheck(
      checks,
      ValidationCheckId.evidence_references,
      async () => {
        await this.evidenceValidator.validate(
          input.investigation,
          repositoryTools
        )

        return {
          message:
            'Investigation files, symbols, and evidence references exist'
        }
      }
    )

    if (!evidencePassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const patchPassed = await this.runCheck(
      checks,
      ValidationCheckId.patch_application,
      async () => {
        const result = await this.patchValidator.validate(
          {
            runId: input.runId,
            investigation: input.investigation,
            reproduction: input.reproduction,
            implementation: input.implementation,
            workspace: input.workspace
          },
          repositoryTools
        )

        finalDiff = result.finalDiff
        changedFiles = result.changedFiles

        return {
          message:
            'Patch revision chain and final workspace diff are valid'
        }
      }
    )

    if (!patchPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const reproductionFailurePassed = await this.runCheck(
      checks,
      ValidationCheckId.reproduction_failure,
      async () => {
        this.reproductionGate.assertExpectedFailure(
          input.reproduction.commandResult,
          input.reproduction.expectedFailureMarker
        )

        return {
          message:
            'Reproduction test failed before implementation for the expected reason',

          artifact: input.reproduction.commandResult.artifact
        }
      }
    )

    if (!reproductionFailurePassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const reproductionSuccessPassed = await this.runCheck(
      checks,
      ValidationCheckId.reproduction_success,
      async () => {
        this.implementationGate.assertReproductionFixed(
          input.implementation.commandResult,
          input.reproduction.expectedFailureMarker
        )

        return {
          message: 'Reproduction test passed after implementation',

          artifact: input.implementation.commandResult.artifact
        }
      }
    )

    if (!reproductionSuccessPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const processRunner = this.processRunnerFactory.create(input.workspace)

    const testsPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.full_test_suite,
      () => processRunner.runTests(),
      'Full test suite passed'
    )

    if (!testsPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const typecheckPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.typecheck,
      () => processRunner.runTypecheck(),
      'Typecheck passed'
    )

    if (!typecheckPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const lintPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.lint,
      () => processRunner.runLint(),
      'Lint passed'
    )

    if (!lintPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const buildPassed = await this.runProcessCheck(
      checks,
      ValidationCheckId.build,
      () => processRunner.runBuild(),
      'Build passed'
    )

    if (!buildPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    const policyPassed = await this.runCheck(
      checks,
      ValidationCheckId.changed_file_policy,
      () => {
        forbiddenFiles = this.changedFilePolicyValidator.getViolations(
          changedFiles,
          input.filePolicy
        )

        if (forbiddenFiles.length > 0) {
          throw new ValidationError(
            `Changed file policy rejected: ` + forbiddenFiles.join(', '),
            ValidationErrorCode.changed_file_policy
          )
        }

        return Promise.resolve({
          message:
            'Changed files satisfy allowed and forbidden file policies'
        })
      }
    )

    if (!policyPassed) {
      return this.finishFailed(
        input,
        checks,
        finalDiff,
        changedFiles,
        forbiddenFiles,
        logger
      )
    }

    return this.finishPassed(
      input,
      checks,
      finalDiff,
      changedFiles,
      logger
    )
  }

  private assertValidInput(input: ValidationInput): void {
    if (input.runId !== input.workspace.runId) {
      throw new ValidationError(
        'Validation run and workspace identifiers do not match',
        ValidationErrorCode.invalid_input
      )
    }

    const policyResult = validationFilePolicySchema.safeParse(
      input.filePolicy
    )

    if (!policyResult.success) {
      throw new ValidationError(
        'Validation file policy is invalid',
        ValidationErrorCode.invalid_input,
        {
          cause: policyResult.error
        }
      )
    }
  }

  private async runProcessCheck(
    checks: MechanicalValidationCheck[],
    id: ValidationCheckId,
    operation: () => Promise<ProcessOperationResult>,
    successMessage: string
  ): Promise<boolean> {
    return this.runCheck(checks, id, async () => {
      const result = await operation()

      assertSuccessfulProcessResult(result)

      return {
        message: successMessage,
        artifact: result.artifact
      }
    })
  }

  private async runCheck(
    checks: MechanicalValidationCheck[],
    id: ValidationCheckId,
    operation: () => Promise<{
      readonly message: string
      readonly artifact?: {
        readonly id: string
        readonly type: string
        readonly relativePath: string
      }
    }>
  ): Promise<boolean> {
    try {
      const result = await operation()

      checks.push({
        id,
        status: MechanicalValidationCheckStatus.passed,
        required: true,
        message: result.message,

        ...(result.artifact === undefined
          ? {}
          : {
              artifact: result.artifact
            })
      })

      return true
    } catch (error) {
      checks.push({
        id,
        status: MechanicalValidationCheckStatus.failed,
        required: true,
        message: getErrorMessage(error)
      })

      return false
    }
  }

  private finishPassed(
    input: ValidationInput,
    checks: readonly MechanicalValidationCheck[],
    finalDiff: string,
    changedFiles: readonly string[],
    logger: Logger
  ): Promise<ValidationResult> {
    return this.finish(
      input,
      checks,
      finalDiff,
      changedFiles,
      [],
      true,
      logger
    )
  }

  private finishFailed(
    input: ValidationInput,
    checks: readonly MechanicalValidationCheck[],
    finalDiff: string,
    changedFiles: readonly string[],
    forbiddenFiles: readonly string[],
    logger: Logger
  ): Promise<never> {
    return this.finish(
      input,
      checks,
      finalDiff,
      changedFiles,
      forbiddenFiles,
      false,
      logger
    ).then((result) => {
      throw new ValidationGateError(result.report, result.artifact)
    })
  }

  private async finish(
    input: ValidationInput,
    completedChecks: readonly MechanicalValidationCheck[],
    finalDiff: string,
    changedFiles: readonly string[],
    forbiddenFiles: readonly string[],
    passed: boolean,
    logger: Logger
  ): Promise<ValidationResult> {
    const checks = [...completedChecks]

    const completedIds = new Set(checks.map((check) => check.id))

    for (const id of orderedCheckIds) {
      if (completedIds.has(id)) {
        continue
      }

      checks.push({
        id,
        status: MechanicalValidationCheckStatus.skipped,
        required: true,
        message: 'Skipped because an earlier deterministic gate failed'
      })
    }

    const report = mechanicalValidationReportSchema.parse({
      schemaVersion: 1,
      runId: input.runId,
      workspaceRevision: input.workspace.workspaceRevision,
      generatedAt: this.now().toISOString(),
      passed,
      changedFiles: [...changedFiles],
      forbiddenFiles: [...forbiddenFiles],
      checks
    })

    let artifact

    try {
      artifact = await this.reportStore.save(report)
    } catch (error) {
      throw new ValidationError(
        'Failed to save final validation report',
        ValidationErrorCode.report_save_failed,
        {
          cause: error
        }
      )
    }

    await this.traceRecorder.record({
      runId: input.runId,
      step: validationStep,
      workspaceRevision: input.workspace.workspaceRevision,
      type: TraceEventType.validation_result,
      output: {
        report,
        artifact
      }
    })

    logger.info('Deterministic validation completed', {
      passed: report.passed,
      changedFileCount: report.changedFiles.length,
      forbiddenFileCount: report.forbiddenFiles.length
    })

    return {
      report,
      artifact,
      finalDiff,
      changedFiles
    }
  }
}

function assertSuccessfulProcessResult(
  result: ProcessOperationResult
): void {
  if (result.timedOut || !result.succeeded || result.exitCode !== 0) {
    throw new ValidationError(
      `${result.operation} failed with exit code ` +
        String(result.exitCode),
      ValidationErrorCode.process_check_failed
    )
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown validation failure'
}
