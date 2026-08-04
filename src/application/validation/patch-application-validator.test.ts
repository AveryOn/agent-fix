import type { ImplementationResult } from '~/core/implementation'
import type { InvestigationResult } from '~/core/investigation'
import type { ReproductionResult } from '~/core/reproduction'
import type { RepositoryTools } from '~/core/workspace'

import { describe, expect, it } from 'vitest'
import { PatchApplicationValidator } from '~/application/validation'
import { ArtifactType } from '~/core/context'
import { ProcessOperation } from '~/core/process'

const investigationRevision = 'revision-001'

const reproductionRevision = 'revision-002'

const implementationRevision = 'revision-003'

describe('PatchApplicationValidator', () => {
  it('validates the applied revision and diff chain', async () => {
    const validator = new PatchApplicationValidator()

    const result = await validator.validate(
      {
        runId: 'run-001',

        investigation: createInvestigation(),

        reproduction: createReproduction(),

        implementation: createImplementation(),

        workspace: {
          runId: 'run-001',
          repositoryPath: '/repository',
          repositoryRoot: '/repository',
          repositoryRelativePath: '',
          workspaceRoot: '/runs/run-001/workspace',
          workspacePath: '/runs/run-001/workspace',
          baseCommit: 'base',
          workspaceRevision: implementationRevision
        }
      },

      createRepositoryTools()
    )

    expect(result.changedFiles).toEqual([
      'src/payment-service.ts',
      'tests/payment.test.ts'
    ])

    expect(result.finalDiff).toContain(
      'diff --git a/src/payment-service.ts'
    )
  })

  it('rejects a stale final workspace', async () => {
    const validator = new PatchApplicationValidator()

    const repositoryTools = createRepositoryTools({
      revision: 'revision-stale'
    })

    await expect(
      validator.validate(
        {
          runId: 'run-001',
          investigation: createInvestigation(),
          reproduction: createReproduction(),
          implementation: createImplementation(),

          workspace: {
            runId: 'run-001',
            repositoryPath: '/repository',
            repositoryRoot: '/repository',
            repositoryRelativePath: '',
            workspaceRoot: '/runs/run-001/workspace',
            workspacePath: '/runs/run-001/workspace',
            baseCommit: 'base',
            workspaceRevision: implementationRevision
          }
        },
        repositoryTools
      )
    ).rejects.toThrow('Current workspace does not match')
  })
})

function createInvestigation(): InvestigationResult {
  return {
    hypothesis: 'createPayment inserts duplicate payments',

    evidence: [
      {
        id: 'evidence-001',
        artifactId: 'investigation-evidence',
        filePath: 'src/payment-service.ts',
        claim: 'createPayment lacks an idempotency check',
        confirmed: true,
        workspaceRevision: investigationRevision,
        symbol: 'createPayment',
        lineStart: 1,
        lineEnd: 3
      }
    ],

    relatedFiles: ['src/payment-service.ts'],

    workspaceRevision: investigationRevision
  }
}

function createReproduction(): ReproductionResult {
  const marker = 'AGENT_FIX_REPRODUCTION: expected one payment'

  return {
    summary: 'Add duplicate payment regression test',

    patch: [
      'diff --git a/tests/payment.test.ts b/tests/payment.test.ts',
      'index 1111111..2222222 100644',
      '--- a/tests/payment.test.ts',
      '+++ b/tests/payment.test.ts',
      '@@ -1,1 +1,2 @@',
      ' describe("payment", () => {})',
      `+throw new Error('${marker}')`
    ].join('\n'),

    testFiles: ['tests/payment.test.ts'],

    expectedFailureMarker: marker,

    sourceWorkspaceRevision: investigationRevision,

    workspaceRevision: reproductionRevision,

    commandResult: createCommandResult(
      'reproduction-execution',
      reproductionRevision,
      false,
      1,
      marker
    ),

    artifacts: {
      reproduction: {
        id: 'reproduction-test',
        type: ArtifactType.reproduction_test,
        workspaceRevision: reproductionRevision,
        relativePath: 'agents/reproduction.json'
      },

      patch: {
        id: 'reproduction-patch',
        type: 'reproduction.patch',
        relativePath: 'patches/reproduction.diff'
      },

      command: {
        id: 'reproduction-execution',
        type: 'command.result',
        relativePath: 'commands/reproduction-execution.json'
      }
    }
  }
}

function createImplementation(): ImplementationResult {
  return {
    summary: 'Add payment idempotency check',

    patch: [
      'diff --git a/src/payment-service.ts b/src/payment-service.ts',
      'index 1111111..2222222 100644',
      '--- a/src/payment-service.ts',
      '+++ b/src/payment-service.ts',
      '@@ -1,3 +1,6 @@',
      ' export function createPayment(eventId: string) {',
      '+  if (payments.has(eventId)) return',
      '   return payments.push({ eventId })',
      ' }'
    ].join('\n'),

    changedFiles: ['src/payment-service.ts'],

    risks: [],

    sourceWorkspaceRevision: reproductionRevision,

    workspaceRevision: implementationRevision,

    commandResult: createCommandResult(
      'implementation-execution',
      implementationRevision,
      true,
      0,
      ''
    ),

    artifacts: {
      implementation: {
        id: 'implementation-result',
        type: 'implementation.result',
        relativePath: 'agents/implementation.json'
      },

      patch: {
        id: 'implementation-patch',
        type: 'implementation.patch',
        relativePath: 'patches/implementation.diff'
      },

      command: {
        id: 'implementation-execution',
        type: 'command.result',
        relativePath: 'commands/implementation-execution.json'
      }
    }
  }
}

function createCommandResult(
  executionId: string,
  workspaceRevision: string,
  succeeded: boolean,
  exitCode: number,
  stderr: string
) {
  return {
    executionId,
    runId: 'run-001',
    workspaceRevision,
    operation: ProcessOperation.run_tests,

    command: {
      executable: 'npm',
      args: ['run', 'test']
    },

    cwd: '/runs/run-001/workspace',

    startedAt: '2026-08-04T16:00:00.000Z',

    completedAt: '2026-08-04T16:00:01.000Z',

    durationMs: 1000,

    stdout: '',
    stderr,
    exitCode,
    signal: null,
    timedOut: false,
    succeeded,

    artifact: {
      id: executionId,
      type: 'command.result' as const,
      relativePath: `commands/${executionId}.json`
    }
  }
}

function createRepositoryTools(
  options: {
    readonly revision?: string
  } = {}
): RepositoryTools {
  const finalDiff = [
    'diff --git a/src/payment-service.ts b/src/payment-service.ts',
    'index 1111111..2222222 100644',
    '--- a/src/payment-service.ts',
    '+++ b/src/payment-service.ts',
    '@@ -1,3 +1,6 @@',
    ' export function createPayment(eventId: string) {',
    '+  if (payments.has(eventId)) return',
    '   return payments.push({ eventId })',
    ' }',
    'diff --git a/tests/payment.test.ts b/tests/payment.test.ts',
    'index 3333333..4444444 100644',
    '--- a/tests/payment.test.ts',
    '+++ b/tests/payment.test.ts',
    '@@ -1,1 +1,2 @@',
    ' describe("payment", () => {})',
    '+it("rejects duplicate payments", () => {})'
  ].join('\n')

  return {
    listFiles: () => Promise.resolve([]),

    searchCode: () => Promise.resolve([]),

    readFile: () => Promise.reject(new Error('Not used')),

    applyPatch: () => Promise.reject(new Error('Not used')),

    getDiff: () => Promise.resolve(finalDiff),

    getChangedFiles: () =>
      Promise.resolve(['src/payment-service.ts', 'tests/payment.test.ts']),

    getWorkspaceRevision: () =>
      Promise.resolve(options.revision ?? implementationRevision)
  }
}
