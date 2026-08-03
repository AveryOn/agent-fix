import type { ModelTokenUsage } from '~/core/model'

export type TokenUsage = ModelTokenUsage

export enum TraceEventType {
  agent_call = 'agent.call',
  agent_result = 'agent.result',
  tool_call = 'tool.call',
  tool_result = 'tool.result',
  validation_result = 'validation.result',
  retry = 'retry',
  failure = 'failure'
}

export interface TraceError {
  readonly name: string
  readonly message: string
  readonly code?: string
  readonly retryable?: boolean
  readonly stack?: string
}

export interface TraceEvent {
  readonly timestamp: string
  readonly runId: string
  readonly step: string
  readonly agent?: string
  readonly attempt?: number
  readonly workspaceRevision?: string
  readonly type: TraceEventType
  readonly input?: unknown
  readonly output?: unknown
  readonly error?: TraceError
  readonly promptVersion?: string
  readonly durationMs?: number
  readonly tokenUsage?: TokenUsage
  readonly estimatedCostUsd?: number
}

export type TraceEventData = Omit<TraceEvent, 'timestamp'>
