import type {
  AgentContextSnapshot,
  EvidenceReference
} from '~/core/context'
import type {
  ProcessOperationResult,
  ProcessResultArtifact
} from '~/core/process'
import type { WorkspaceSnapshot } from '~/core/workspace'

import { z } from 'zod'
import { AgentRole } from '~/core/context'

const repositoryRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isRepositoryRelativePath, {
    message: 'Path must be repository-relative'
  })

const confirmedEvidenceSchema = z
  .object({
    id: z.string().trim().min(1).max(200),

    artifactId: z.string().trim().min(1).max(200),

    filePath: repositoryRelativePathSchema,

    claim: z.string().trim().min(1).max(2000),

    confirmed: z.literal(true),

    workspaceRevision: z.string().trim().min(1),

    symbol: z.string().trim().min(1).nullable().optional(),

    lineStart: z.number().int().positive(),

    lineEnd: z.number().int().positive()
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.lineEnd < evidence.lineStart) {
      context.addIssue({
        code: 'custom',
        path: ['lineEnd'],
        message: 'lineEnd must be greater than or equal to lineStart'
      })
    }
  })

export const allowedFileScopeSchema = z
  .object({
    files: z.array(repositoryRelativePathSchema).min(1).max(100),

    workspaceRevision: z.string().trim().min(1)
  })
  .strict()
  .superRefine((scope, context) => {
    const uniqueFiles = new Set(scope.files)

    if (uniqueFiles.size !== scope.files.length) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Allowed file scope contains duplicate paths'
      })
    }
  })

const failingCommandResultSchema = z
  .object({
    executionId: z.string().trim().min(1),

    exitCode: z
      .number()
      .int()
      .refine((value) => value !== 0, {
        message:
          'Failing reproduction command must have a non-zero exit code'
      }),

    timedOut: z.literal(false),

    succeeded: z.literal(false),

    stdout: z.string().max(500_000),

    stderr: z.string().max(500_000)
  })
  .strict()

export const reproductionFailureSnapshotSchema = z
  .object({
    testFiles: z.array(repositoryRelativePathSchema).min(1).max(20),

    expectedFailureMarker: z.string().trim().min(1).max(400),

    workspaceRevision: z.string().trim().min(1),

    commandResult: failingCommandResultSchema
  })
  .strict()
  .superRefine((reproduction, context) => {
    const commandOutput = normalizeCommandOutput(
      `${reproduction.commandResult.stdout}\n` +
        reproduction.commandResult.stderr
    )

    if (!commandOutput.includes(reproduction.expectedFailureMarker)) {
      context.addIssue({
        code: 'custom',
        path: ['commandResult'],
        message:
          'Failing command output does not contain the expected marker'
      })
    }

    const uniqueTestFiles = new Set(reproduction.testFiles)

    if (uniqueTestFiles.size !== reproduction.testFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['testFiles'],
        message: 'Reproduction snapshot contains duplicate test files'
      })
    }
  })

const implementerContextSnapshotSchema = z
  .object({
    agent: z.literal(AgentRole.implementer),

    createdAt: z.string().trim().min(1),

    estimatedTokens: z.number().int().nonnegative(),

    context: z
      .object({
        runId: z.string().trim().min(1),

        task: z.string().trim().min(1),

        workspaceRevision: z.string().trim().min(1),

        artifactIds: z.array(z.string().trim().min(1)),

        evidence: z.array(z.unknown()),

        constraints: z.array(z.string()),

        summary: z.string().optional()
      })
      .strict()
  })
  .strict()

const workspaceSnapshotSchema = z
  .object({
    runId: z.string().trim().min(1),

    repositoryPath: z.string().trim().min(1),

    repositoryRoot: z.string().trim().min(1),

    repositoryRelativePath: z.string(),

    workspaceRoot: z.string().trim().min(1),

    workspacePath: z.string().trim().min(1),

    baseCommit: z.string().trim().min(1),

    workspaceRevision: z.string().trim().min(1)
  })
  .strict()

export const implementationInputSchema = z
  .object({
    context: implementerContextSnapshotSchema,

    evidence: z.array(confirmedEvidenceSchema).min(1).max(50),

    reproduction: reproductionFailureSnapshotSchema,

    allowedFileScope: allowedFileScopeSchema,

    workspace: workspaceSnapshotSchema
  })
  .strict()
  .superRefine((input, context) => {
    const expectedRevision = input.context.context.workspaceRevision

    if (input.context.context.runId !== input.workspace.runId) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'runId'],
        message: 'Context and workspace run identifiers do not match'
      })
    }

    if (input.workspace.workspaceRevision !== expectedRevision) {
      context.addIssue({
        code: 'custom',
        path: ['workspace', 'workspaceRevision'],
        message: 'Context and workspace revisions do not match'
      })
    }

    if (input.reproduction.workspaceRevision !== expectedRevision) {
      context.addIssue({
        code: 'custom',
        path: ['reproduction', 'workspaceRevision'],
        message: 'Reproduction and context revisions do not match'
      })
    }

    if (input.allowedFileScope.workspaceRevision !== expectedRevision) {
      context.addIssue({
        code: 'custom',
        path: ['allowedFileScope', 'workspaceRevision'],
        message: 'Allowed file scope and context revisions do not match'
      })
    }

    for (const evidence of input.evidence) {
      if (evidence.workspaceRevision !== expectedRevision) {
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: `Evidence ${evidence.id} belongs to a stale workspace`
        })
      }
    }

    const reproductionTestFiles = new Set(input.reproduction.testFiles)

    for (const filePath of input.allowedFileScope.files) {
      if (reproductionTestFiles.has(filePath)) {
        context.addIssue({
          code: 'custom',
          path: ['allowedFileScope', 'files'],
          message:
            `Reproduction test ${filePath} must not be ` +
            'included in the implementation scope'
        })
      }
    }
  })

export const implementationPlanSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),

    patch: z.string().trim().min(1).max(500_000),

    changedFiles: z.array(repositoryRelativePathSchema).min(1).max(100),

    risks: z.array(z.string().trim().min(1).max(1000)).max(20),

    workspaceRevision: z.string().trim().min(1)
  })
  .strict()
  .superRefine((plan, context) => {
    const uniqueFiles = new Set(plan.changedFiles)

    if (uniqueFiles.size !== plan.changedFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['changedFiles'],
        message: 'Implementation output contains duplicate changed files'
      })
    }
  })

export type AllowedFileScope = z.infer<typeof allowedFileScopeSchema>

export type ReproductionFailureSnapshot = z.infer<
  typeof reproductionFailureSnapshotSchema
>

export type ImplementationPlan = z.infer<typeof implementationPlanSchema>

export interface ImplementationInput {
  readonly context: AgentContextSnapshot
  readonly evidence: readonly EvidenceReference[]
  readonly reproduction: ReproductionFailureSnapshot
  readonly allowedFileScope: AllowedFileScope
  readonly workspace: WorkspaceSnapshot
}

export interface StoredImplementationArtifact {
  readonly id: string
  readonly type: string
  readonly relativePath: string
}

export interface StoredImplementationArtifacts {
  readonly implementation: StoredImplementationArtifact
  readonly patch: StoredImplementationArtifact
  readonly command: ProcessResultArtifact
}

export interface SaveImplementationArtifactsInput {
  readonly runId: string
  readonly plan: ImplementationPlan
  readonly sourceWorkspaceRevision: string
  readonly workspaceRevision: string
  readonly reproduction: ReproductionFailureSnapshot
  readonly commandResult: ProcessOperationResult
}

export interface ImplementationArtifactStore {
  save(
    input: SaveImplementationArtifactsInput
  ): Promise<StoredImplementationArtifacts>
}

export interface ImplementationResult {
  readonly summary: string
  readonly patch: string
  readonly changedFiles: readonly string[]
  readonly risks: readonly string[]
  readonly sourceWorkspaceRevision: string
  readonly workspaceRevision: string
  readonly commandResult: ProcessOperationResult
  readonly artifacts: StoredImplementationArtifacts
}

export interface ImplementerAgent {
  execute(input: ImplementationInput): Promise<ImplementationResult>
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

function normalizeCommandOutput(output: string): string {
  return (
    output

      // eslint-disable-next-line no-control-regex
      .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replaceAll('\r\n', '\n')
  )
}
