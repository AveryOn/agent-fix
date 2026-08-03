import type { z } from 'zod'

export type ModelMessageRole = 'system' | 'user' | 'assistant'

export interface ModelMessage {
  readonly type: 'message'
  readonly role: ModelMessageRole
  readonly content: string
}

export interface ModelToolResult {
  readonly type: 'tool_result'
  readonly callId: string
  readonly output: string
}

export type ModelInput = ModelMessage | ModelToolResult

export interface ModelTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<unknown>
}

export interface ModelToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

export interface ModelTokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

export interface ModelRequest<TOutput> {
  readonly input: readonly ModelInput[]
  readonly outputSchemaName: string
  readonly outputSchema: z.ZodType<TOutput>
  readonly tools?: readonly ModelTool[]
  readonly previousResponseId?: string
}

export interface ModelResult<TOutput> {
  readonly output?: TOutput
  readonly toolCalls: readonly ModelToolCall[]
  readonly usage: ModelTokenUsage
  readonly durationMs: number
  readonly responseId?: string
}

export interface ModelProvider {
  generate<TOutput>(
    request: ModelRequest<TOutput>
  ): Promise<ModelResult<TOutput>>
}
