import { z } from 'zod'

export const MechanicalValidationCheckStatus = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped'
} as const

export type MechanicalValidationCheckStatus =
  (typeof MechanicalValidationCheckStatus)[keyof typeof MechanicalValidationCheckStatus]

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

const validationArtifactSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.string().trim().min(1),
    relativePath: repositoryRelativePathSchema
  })
  .strict()

export const mechanicalValidationCheckSchema = z
  .object({
    id: z.string().trim().min(1).max(200),

    status: checkStatusSchema,

    required: z.boolean(),

    message: z.string().trim().min(1).max(2000),

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
    const uniqueChangedFiles = new Set(report.changedFiles)

    if (uniqueChangedFiles.size !== report.changedFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['changedFiles'],
        message: 'Validation report contains duplicate changed files'
      })
    }

    const uniqueCheckIds = new Set(report.checks.map((check) => check.id))

    if (uniqueCheckIds.size !== report.checks.length) {
      context.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'Validation report contains duplicate check identifiers'
      })
    }

    const requiredChecksPassed = report.checks
      .filter((check) => check.required)
      .every(
        (check) => check.status === MechanicalValidationCheckStatus.passed
      )

    const hasForbiddenFiles = report.forbiddenFiles.length > 0

    const expectedPassed = requiredChecksPassed && !hasForbiddenFiles

    if (report.passed !== expectedPassed) {
      context.addIssue({
        code: 'custom',
        path: ['passed'],
        message: 'Validation report passed state does not match its checks'
      })
    }
  })

export type MechanicalValidationCheck = z.infer<
  typeof mechanicalValidationCheckSchema
>

export type MechanicalValidationReport = z.infer<
  typeof mechanicalValidationReportSchema
>

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
