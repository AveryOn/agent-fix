import type { ImplementationResult } from '~/core/implementation'
import type { InvestigationResult } from '~/core/investigation'
import type { ReproductionResult } from '~/core/reproduction'
import type { ReviewDecision } from '~/core/review'

import { z } from 'zod'
import { ArtifactType } from '~/core/context'
import { implementationPlanSchema } from '~/core/implementation'
import { investigationResultSchema } from '~/core/investigation'
import { ProcessOperation } from '~/core/process'
import { reproductionPlanSchema } from '~/core/reproduction'
import { reviewDecisionSchema } from '~/core/review'
import { ValidationError, ValidationErrorCode } from '~/core/validation'

const repositoryRelativePathSchema = z.string().trim().min(1).max(500)

const processResultArtifactSchema = z
  .object({
    id: z.string().trim().min(1),

    type: z.literal('command.result'),

    relativePath: repositoryRelativePathSchema
  })
  .strict()

const processOperationResultSchema = z
  .object({
    executionId: z.string().trim().min(1),

    runId: z.string().trim().min(1),

    workspaceRevision: z.string().trim().min(1),

    operation: z.enum([
      ProcessOperation.run_tests,
      ProcessOperation.run_typecheck,
      ProcessOperation.run_lint,
      ProcessOperation.run_build
    ]),

    command: z
      .object({
        executable: z.string().trim().min(1),

        args: z.array(z.string())
      })
      .strict(),

    cwd: z.string().trim().min(1),

    startedAt: z.string().trim().min(1),

    completedAt: z.string().trim().min(1),

    durationMs: z.number().int().nonnegative(),

    stdout: z.string(),

    stderr: z.string(),

    exitCode: z.number().int().nullable(),

    signal: z.string().nullable(),

    timedOut: z.boolean(),

    succeeded: z.boolean(),

    artifact: processResultArtifactSchema
  })
  .strict()

const storedArtifactSchema = z
  .object({
    id: z.string().trim().min(1),

    type: z.string().trim().min(1),

    relativePath: repositoryRelativePathSchema
  })
  .strict()

const reproductionArtifactSchema = storedArtifactSchema.extend({
  type: z.literal(ArtifactType.reproduction_test),

  workspaceRevision: z.string().trim().min(1)
})

const reproductionResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),

    patch: z.string().trim().min(1).max(200_000),

    testFiles: z.array(repositoryRelativePathSchema).min(1).max(20),

    expectedFailureMarker: z.string().trim().min(1).max(400),

    sourceWorkspaceRevision: z.string().trim().min(1),

    workspaceRevision: z.string().trim().min(1),

    commandResult: processOperationResultSchema,

    artifacts: z
      .object({
        reproduction: reproductionArtifactSchema,

        patch: storedArtifactSchema,

        command: processResultArtifactSchema
      })
      .strict()
  })
  .strict()

const implementationResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),

    patch: z.string().trim().min(1).max(500_000),

    changedFiles: z.array(repositoryRelativePathSchema).min(1).max(100),

    risks: z.array(z.string().trim().min(1).max(1000)).max(20),

    sourceWorkspaceRevision: z.string().trim().min(1),

    workspaceRevision: z.string().trim().min(1),

    commandResult: processOperationResultSchema,

    artifacts: z
      .object({
        implementation: storedArtifactSchema,

        patch: storedArtifactSchema,

        command: processResultArtifactSchema
      })
      .strict()
  })
  .strict()

export interface ValidatedPreReviewOutputs {
  readonly investigation: InvestigationResult

  readonly reproduction: ReproductionResult

  readonly implementation: ImplementationResult
}

export class AgentOutputSchemaValidator {
  validatePreReview(
    investigation: unknown,
    reproduction: unknown,
    implementation: unknown
  ): ValidatedPreReviewOutputs {
    return {
      investigation: this.validateInvestigation(investigation),

      reproduction: this.validateReproduction(reproduction),

      implementation: this.validateImplementation(implementation)
    }
  }

  validateInvestigation(value: unknown): InvestigationResult {
    return parseOutput(investigationResultSchema, value, 'Investigator')
  }

  validateReproduction(value: unknown): ReproductionResult {
    const result = parseOutput(
      reproductionResultSchema,
      value,
      'Reproducer'
    )

    parseOutput(
      reproductionPlanSchema,
      {
        summary: result.summary,
        patch: result.patch,
        testFiles: result.testFiles,
        expectedFailureMarker: result.expectedFailureMarker,
        workspaceRevision: result.sourceWorkspaceRevision
      },
      'Reproducer plan'
    )

    return result
  }

  validateImplementation(value: unknown): ImplementationResult {
    const result = parseOutput(
      implementationResultSchema,
      value,
      'Implementer'
    )

    parseOutput(
      implementationPlanSchema,
      {
        summary: result.summary,
        patch: result.patch,
        changedFiles: result.changedFiles,
        risks: result.risks,
        workspaceRevision: result.sourceWorkspaceRevision
      },
      'Implementer plan'
    )

    return result
  }

  validateReview(value: unknown): ReviewDecision {
    return parseOutput(reviewDecisionSchema, value, 'Reviewer')
  }
}

function parseOutput<TOutput>(
  schema: z.ZodType<TOutput>,
  value: unknown,
  agentName: string
): TOutput {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new ValidationError(
      `${agentName} output failed schema validation: ` +
        z.prettifyError(result.error),
      ValidationErrorCode.agent_output_schema,
      {
        cause: result.error
      }
    )
  }

  return result.data
}
