import type { AgentRole } from '~/core/context/agent-context'

export class ContextBudgetExceededError extends Error {
  readonly agent: AgentRole
  readonly estimatedTokens: number
  readonly tokenBudget: number

  constructor(
    agent: AgentRole,
    estimatedTokens: number,
    tokenBudget: number
  ) {
    super(
      `Context budget exceeded for ${agent}: ` +
        `${estimatedTokens} tokens estimated, ` +
        `${tokenBudget} allowed`
    )

    this.name = 'ContextBudgetExceededError'
    this.agent = agent
    this.estimatedTokens = estimatedTokens
    this.tokenBudget = tokenBudget
  }
}

export class StaleWorkspaceContextError extends Error {
  readonly referenceId: string
  readonly expectedRevision: string
  readonly actualRevision: string

  constructor(
    referenceId: string,
    expectedRevision: string,
    actualRevision: string
  ) {
    super(
      `Context reference ${referenceId} belongs to workspace ` +
        `${actualRevision}, expected ${expectedRevision}`
    )

    this.name = 'StaleWorkspaceContextError'
    this.referenceId = referenceId
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export class StaleAgentResultError extends Error {
  readonly expectedRevision: string
  readonly actualRevision: string

  constructor(expectedRevision: string, actualRevision: string) {
    super(
      `Agent result belongs to workspace ${actualRevision}, ` +
        `expected ${expectedRevision}`
    )

    this.name = 'StaleAgentResultError'
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}
