import type { ArtifactReference, EvidenceReference } from '~/core/context'
import type { ImplementationResult } from '~/core/implementation'
import type { InvestigationResult } from '~/core/investigation'
import type { ReproductionResult } from '~/core/reproduction'
import type { WorkspaceSnapshot } from '~/core/workspace'

import { z } from 'zod'

export const MechanicalValidationCheckStatus = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped'
} as const

export type MechanicalValidationCheckStatus =
  (typeof MechanicalValidationCheckStatus)[keyof typeof MechanicalValidationCheckStatus]

export const ValidationCheckId = {
  agent_output_schema: 'agent_output_schema',
  evidence_references: 'evidence_references',
  patch_application: 'patch_application',
  reproduction_failure: 'reproduction_failure',
  reproduction_success: 'reproduction_success',
  full_test_suite: 'full_test_suite',
  typecheck: 'typecheck',
  lint: 'lint',
  build: 'build',
  changed_file_policy: 'changed_file_policy'
} as const

export type ValidationCheckId =
  (typeof ValidationCheckId)[keyof typeof ValidationCheckId]

const checkStatusSchema = z.enum([
  MechanicalValidationCheckStatus.passed,
  MechanicalValidationCheckStatus.failed,
  MechanicalValidationCheckStatus.skipped
])

const repositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isRepositoryRelativePath, {
    message: 'Path must be repository-relative'
  })

const repositoryPathPrefixSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isRepositoryRelativePrefix, {
    message: 'Path prefix must be repository-relative'
  })

const validationArtifactSchema = z
  .object({
    id: z.string().trim().min(1),

    type: z.string().trim().min(1),

    relativePath: repositoryRelativePathSchema
  })
  .strict()

export const mechanicalValidationCheckSchema = z
  .object({
    id: z.enum([
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
    ]),

    status: checkStatusSchema,

    required: z.boolean(),

    message: z.string().trim().min(1).max(4000),

    artifact: validationArtifactSchema.optional()
  })
  .strict()

export const mechanicalValidationReportSchema = z
  .object({
    schemaVersion: z.literal(1),

    runId: z.string().trim().min(1),

    workspaceRevision: z.string().trim().min(1),

    generatedAt: z.string().trim().min(1),

    passed: z.boolean(),

    changedFiles: z.array(repositoryRelativePathSchema).max(200),

    forbiddenFiles: z.array(repositoryRelativePathSchema).max(200),

    checks: z.array(mechanicalValidationCheckSchema).min(1).max(100)
  })
  .strict()
  .superRefine((report, context) => {
    assertUniqueStrings(
      report.changedFiles,
      ['changedFiles'],
      'Validation report contains duplicate changed files',
      context
    )

    assertUniqueStrings(
      report.forbiddenFiles,
      ['forbiddenFiles'],
      'Validation report contains duplicate forbidden files',
      context
    )

    assertUniqueStrings(
      report.checks.map((check) => check.id),
      ['checks'],
      'Validation report contains duplicate check identifiers',
      context
    )

    const requiredChecksPassed = report.checks
      .filter((check) => check.required)
      .every(
        (check) => check.status === MechanicalValidationCheckStatus.passed
      )

    const expectedPassed =
      requiredChecksPassed && report.forbiddenFiles.length === 0

    if (report.passed !== expectedPassed) {
      context.addIssue({
        code: 'custom',
        path: ['passed'],
        message: 'Validation report passed state does not match its checks'
      })
    }
  })

export const validationFilePolicySchema = z
  .object({
    allowedFiles: z.array(repositoryRelativePathSchema).min(1).max(200),

    forbiddenFiles: z.array(repositoryRelativePathSchema).max(200),

    forbiddenPrefixes: z.array(repositoryPathPrefixSchema).max(100)
  })
  .strict()
  .superRefine((policy, context) => {
    assertUniqueStrings(
      policy.allowedFiles,
      ['allowedFiles'],
      'Allowed file policy contains duplicate paths',
      context
    )

    assertUniqueStrings(
      policy.forbiddenFiles,
      ['forbiddenFiles'],
      'Forbidden file policy contains duplicate paths',
      context
    )

    assertUniqueStrings(
      policy.forbiddenPrefixes,
      ['forbiddenPrefixes'],
      'Forbidden prefix policy contains duplicate paths',
      context
    )
  })

export type MechanicalValidationCheck = z.infer<
  typeof mechanicalValidationCheckSchema
>

export type MechanicalValidationReport = z.infer<
  typeof mechanicalValidationReportSchema
>

export type ValidationFilePolicy = z.infer<
  typeof validationFilePolicySchema
>

export interface ValidationInput {
  readonly runId: string

  readonly investigation: InvestigationResult

  readonly reproduction: ReproductionResult

  readonly implementation: ImplementationResult

  readonly evidence: readonly EvidenceReference[]

  readonly workspace: WorkspaceSnapshot

  readonly filePolicy: ValidationFilePolicy
}

export interface StoredValidationReportArtifact extends ArtifactReference {
  readonly relativePath: string
}

export interface ValidationResult {
  readonly report: MechanicalValidationReport

  readonly artifact: StoredValidationReportArtifact

  readonly finalDiff: string

  readonly changedFiles: readonly string[]
}

export interface ValidationReportStore {
  save(
    report: MechanicalValidationReport
  ): Promise<StoredValidationReportArtifact>
}

export interface ValidationService {
  execute(input: ValidationInput): Promise<ValidationResult>
}

function assertUniqueStrings(
  values: readonly string[],
  path: readonly PropertyKey[],
  message: string,
  context: z.core.$RefinementCtx
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: 'custom',
      path: [...path],
      message
    })
  }
}

function isRepositoryRelativePath(value: string): boolean {
  if (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    /^[a-zA-Z]:/.test(value)
  ) {
    return false
  }

  return value
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 && segment !== '.' && segment !== '..'
    )
}

function isRepositoryRelativePrefix(value: string): boolean {
  const normalized = value.endsWith('/') ? value.slice(0, -1) : value

  return normalized.length > 0 && isRepositoryRelativePath(normalized)
}
