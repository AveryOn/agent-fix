import type {
  ArtifactReference,
  CreateAgentContextInput,
  EvidenceReference,
  TokenEstimator
} from '~/core/context'

import { describe, expect, it } from 'vitest'
import {
  AgentContextManager,
  AgentRole,
  ArtifactType,
  ContextBudgetExceededError,
  StaleAgentResultError,
  StaleWorkspaceContextError,
  getAgentVisibilityPolicy
} from '~/core/context'

const workspaceRevision = 'revision-001'

const artifacts: ArtifactReference[] = [
  createArtifact('repository', ArtifactType.repository_snapshot),
  createArtifact(
    'investigation-result',
    ArtifactType.investigation_result
  ),
  createArtifact(
    'investigation-evidence',
    ArtifactType.investigation_evidence
  ),
  createArtifact('test-structure', ArtifactType.test_structure),
  createArtifact('reproduction-test', ArtifactType.reproduction_test),
  createArtifact('allowed-file-scope', ArtifactType.allowed_file_scope),
  createArtifact('final-diff', ArtifactType.final_diff),
  createArtifact('validation-report', ArtifactType.validation_report),
  createArtifact('changed-files', ArtifactType.changed_files)
]

const evidence: EvidenceReference[] = [
  {
    id: 'evidence-confirmed',
    artifactId: 'investigation-evidence',
    filePath: 'src/payment-service.ts',
    claim: 'Payment insertion lacks an idempotency guard',
    confirmed: true,
    workspaceRevision,
    symbol: 'createPayment',
    lineStart: 20,
    lineEnd: 40
  },
  {
    id: 'evidence-unconfirmed',
    artifactId: 'investigation-evidence',
    filePath: 'src/unrelated.ts',
    claim: 'Unconfirmed speculation',
    confirmed: false,
    workspaceRevision
  }
]

describe('AgentContextManager', () => {
  it('enforces artifact visibility for every agent', () => {
    const manager = createManager()

    const investigator = manager.createSnapshot(
      createInput(AgentRole.investigator)
    )

    expect(investigator.context.artifactIds).toEqual(['repository'])

    expect(investigator.context.evidence).toEqual([])

    expect(investigator.context.task).toBe(
      'Duplicate webhook creates two payments'
    )

    const reproducer = manager.createSnapshot(
      createInput(AgentRole.reproducer)
    )

    expect(reproducer.context.artifactIds).toEqual([
      'investigation-result',
      'investigation-evidence',
      'test-structure'
    ])

    expect(
      reproducer.context.evidence.map((reference) => reference.id)
    ).toEqual(['evidence-confirmed'])

    const implementer = manager.createSnapshot(
      createInput(AgentRole.implementer)
    )

    expect(implementer.context.artifactIds).toEqual([
      'investigation-evidence',
      'reproduction-test',
      'allowed-file-scope'
    ])

    expect(implementer.context.task).not.toContain('Duplicate webhook')

    const reviewer = manager.createSnapshot(
      createInput(AgentRole.reviewer)
    )

    expect(reviewer.context.artifactIds).toEqual([
      'final-diff',
      'validation-report',
      'changed-files'
    ])

    expect(reviewer.context.evidence).toEqual([])

    expect(reviewer.context.task).not.toContain('Duplicate webhook')
  })

  it('defines repository tool access only for the investigator', () => {
    expect(
      getAgentVisibilityPolicy(AgentRole.investigator).allowRepositoryTools
    ).toBe(true)

    expect(
      getAgentVisibilityPolicy(AgentRole.reproducer).allowRepositoryTools
    ).toBe(false)

    expect(
      getAgentVisibilityPolicy(AgentRole.implementer).allowRepositoryTools
    ).toBe(false)

    expect(
      getAgentVisibilityPolicy(AgentRole.reviewer).allowRepositoryTools
    ).toBe(false)
  })

  it('passes artifact references instead of artifact contents', () => {
    const manager = createManager()

    const snapshot = manager.createSnapshot(
      createInput(AgentRole.reproducer)
    )

    expect(snapshot.context).toHaveProperty('artifactIds')

    expect(snapshot.context).not.toHaveProperty('artifacts')

    expect(snapshot.context).not.toHaveProperty('history')
  })

  it('summarizes an oversized investigation context', () => {
    const manager = new AgentContextManager({
      tokenBudget: 100,
      tokenEstimator: new SummaryAwareTokenEstimator(),
      now: () => new Date('2026-08-03T20:00:00.000Z')
    })

    const snapshot = manager.createSnapshot({
      ...createInput(AgentRole.reproducer),
      investigation: {
        hypothesis: 'A'.repeat(2000),
        relatedFiles: ['src/payment-service.ts', 'src/webhook-handler.ts']
      }
    })

    expect(snapshot.estimatedTokens).toBe(50)

    expect(snapshot.context.summary).toContain('Hypothesis:')

    expect(snapshot.context.summary).toContain('Related files:')

    expect(snapshot.context.evidence[0]?.claim.length).toBeLessThanOrEqual(
      160
    )
  })

  it('rejects an oversized context that cannot be summarized', () => {
    const manager = new AgentContextManager({
      tokenBudget: 100,
      tokenEstimator: {
        estimate: () => 500
      }
    })

    expect(() =>
      manager.createSnapshot(createInput(AgentRole.investigator))
    ).toThrow(ContextBudgetExceededError)
  })

  it('rejects stale artifact references', () => {
    const manager = createManager()

    expect(() =>
      manager.createSnapshot({
        ...createInput(AgentRole.reproducer),
        artifacts: [
          {
            id: 'stale-investigation',
            type: ArtifactType.investigation_result,
            workspaceRevision: 'revision-old'
          }
        ]
      })
    ).toThrow(StaleWorkspaceContextError)
  })

  it('rejects stale agent results', () => {
    const manager = createManager()

    const snapshot = manager.createSnapshot(
      createInput(AgentRole.implementer)
    )

    expect(() =>
      manager.assertFreshResult(snapshot, {
        workspaceRevision: 'revision-old'
      })
    ).toThrow(StaleAgentResultError)

    expect(() =>
      manager.assertFreshResult(snapshot, {
        workspaceRevision
      })
    ).not.toThrow()
  })

  it('attaches the workspace revision to every snapshot', () => {
    const manager = createManager()

    for (const agent of Object.values(AgentRole)) {
      const snapshot = manager.createSnapshot(createInput(agent))

      expect(snapshot.context.workspaceRevision).toBe(workspaceRevision)
    }
  })
})

class SummaryAwareTokenEstimator implements TokenEstimator {
  estimate(value: unknown): number {
    if (
      typeof value === 'object' &&
      value !== null &&
      'summary' in value
    ) {
      return 50
    }

    return 500
  }
}

function createManager(): AgentContextManager {
  return new AgentContextManager({
    tokenBudget: 10_000,
    now: () => new Date('2026-08-03T20:00:00.000Z')
  })
}

function createInput(agent: AgentRole): CreateAgentContextInput {
  return {
    runId: 'run-001',
    agent,
    task: 'Duplicate webhook creates two payments',
    workspaceRevision,
    artifacts,
    evidence,
    constraints: ['Do not modify public APIs', 'Do not modify public APIs']
  }
}

function createArtifact(
  id: string,
  type: ArtifactType
): ArtifactReference {
  return {
    id,
    type,
    workspaceRevision
  }
}
