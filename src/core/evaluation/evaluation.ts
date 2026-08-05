import type { PromptVersionSnapshot } from '~/core/prompt'

import { z } from 'zod'

export const evaluationCaseIdSchema = z.enum([
  'duplicate-payment-fix',
  'hallucinated-file-reference',
  'reproduction-test-already-passes',
  'typecheck-failure',
  'forbidden-file-modification',
  'retry-then-success'
])

export const evaluationClassificationSchema = z.enum([
  'accepted',
  'accepted_after_retry',
  'hallucinated_file_rejected',
  'pre_fix_test_pass_rejected',
  'typecheck_failure_rejected',
  'forbidden_file_rejected',
  'unexpected_failure'
])

export const evaluationExpectationSchema = z
  .object({
    classification: evaluationClassificationSchema,

    passed: z.boolean(),

    attempts: z.number().int().positive(),

    errorCode: z.string().nullable()
  })
  .strict()

export const evaluationCaseDefinitionSchema = z
  .object({
    id: evaluationCaseIdSchema,

    name: z.string().trim().min(1),

    description: z.string().trim().min(1),

    expected: evaluationExpectationSchema
  })
  .strict()

export const evaluationCaseResultSchema = z
  .object({
    id: evaluationCaseIdSchema,

    name: z.string().trim().min(1),

    passed: z.boolean(),

    expected: evaluationExpectationSchema,

    actual: evaluationExpectationSchema,

    durationMs: z.number().nonnegative()
  })
  .strict()

export const evaluationSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),

    passed: z.number().int().nonnegative(),

    failed: z.number().int().nonnegative(),

    passRate: z.number().min(0).max(1)
  })
  .strict()

export const evaluationRunResultSchema = z
  .object({
    schemaVersion: z.literal(1),

    suiteId: z.literal('agent-fix-core-evaluation'),

    generatedAt: z.string().datetime(),

    promptVersions: z
      .object({
        investigator: z.string().trim().min(1),

        reproducer: z.string().trim().min(1),

        implementer: z.string().trim().min(1),

        reviewer: z.string().trim().min(1)
      })
      .strict(),

    cases: z.array(evaluationCaseResultSchema),

    summary: evaluationSummarySchema
  })
  .strict()

export const evaluationRegressionSchema = z
  .object({
    caseId: evaluationCaseIdSchema,

    field: z.enum([
      'missing_case',
      'passed',
      'classification',
      'attempts',
      'error_code',
      'prompt_version'
    ]),

    baseline: z.unknown(),

    current: z.unknown()
  })
  .strict()

export const evaluationComparisonSchema = z
  .object({
    schemaVersion: z.literal(1),

    comparedAt: z.string().datetime(),

    passed: z.boolean(),

    regressions: z.array(evaluationRegressionSchema)
  })
  .strict()

export type EvaluationCaseId = z.infer<typeof evaluationCaseIdSchema>

export type EvaluationClassification = z.infer<
  typeof evaluationClassificationSchema
>

export type EvaluationExpectation = z.infer<
  typeof evaluationExpectationSchema
>

export type EvaluationCaseDefinition = z.infer<
  typeof evaluationCaseDefinitionSchema
>

export type EvaluationCaseResult = z.infer<
  typeof evaluationCaseResultSchema
>

export type EvaluationRunResult = z.infer<typeof evaluationRunResultSchema>

export type EvaluationRegression = z.infer<
  typeof evaluationRegressionSchema
>

export type EvaluationComparison = z.infer<
  typeof evaluationComparisonSchema
>

export interface EvaluationCaseExecutionResult {
  readonly classification: EvaluationClassification
  readonly attempts: number
  readonly errorCode: string | null
}

export interface EvaluationCase {
  readonly definition: EvaluationCaseDefinition

  execute(): Promise<EvaluationCaseExecutionResult>
}

export interface EvaluationStore {
  loadBaseline(): Promise<EvaluationRunResult>

  saveCurrent(result: EvaluationRunResult): Promise<void>

  saveComparison(comparison: EvaluationComparison): Promise<void>
}

export interface EvaluationRunnerInput {
  readonly promptVersions: PromptVersionSnapshot
  readonly cases: readonly EvaluationCase[]
}
