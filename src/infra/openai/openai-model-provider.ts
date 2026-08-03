import type {
  ModelInput,
  ModelProvider,
  ModelRequest,
  ModelResult,
  ModelTokenUsage,
  ModelTool,
  ModelToolCall
} from '~/core/model'

import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { ModelProviderError, ModelProviderErrorCode } from '~/core/model'

export interface OpenAiModelProviderOptions {
  readonly apiKey: string
  readonly model: string
  readonly timeoutMs: number
  readonly baseUrl?: string
  readonly fetchImplementation?: typeof fetch
}

export class OpenAiModelProvider implements ModelProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly baseUrl: string
  private readonly fetchImplementation: typeof fetch

  constructor(options: OpenAiModelProviderOptions) {
    this.apiKey = options.apiKey
    this.model = options.model
    this.timeoutMs = options.timeoutMs
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com/v1'
    this.fetchImplementation = options.fetchImplementation ?? fetch
  }

  async generate<TOutput>(
    request: ModelRequest<TOutput>
  ): Promise<ModelResult<TOutput>> {
    const startedAt = performance.now()

    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}/responses`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(this.createRequestBody(request)),
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      )

      const durationMs = performance.now() - startedAt
      const payload: unknown = await response.json()

      if (!response.ok) {
        throw mapOpenAiHttpError(response.status, payload, durationMs)
      }

      return parseOpenAiResponse(request, payload, durationMs)
    } catch (error) {
      const durationMs = performance.now() - startedAt

      if (error instanceof ModelProviderError) {
        throw error
      }

      if (isTimeoutError(error)) {
        throw new ModelProviderError('OpenAI request timed out', {
          code: ModelProviderErrorCode.timeout,
          retryable: true,
          durationMs,
          cause: error
        })
      }

      throw new ModelProviderError('OpenAI request failed', {
        code: ModelProviderErrorCode.network,
        retryable: true,
        durationMs,
        cause: error
      })
    }
  }

  private createRequestBody<TOutput>(
    request: ModelRequest<TOutput>
  ): Record<string, unknown> {
    const tools = request.tools ?? []

    return {
      model: this.model,

      input: request.input.map(mapModelInput),

      text: {
        format: {
          type: 'json_schema',
          name: request.outputSchemaName,
          schema: z.toJSONSchema(request.outputSchema),
          strict: true
        }
      },

      ...(tools.length === 0
        ? {}
        : {
            tools: tools.map(mapModelTool),
            tool_choice: 'auto'
          }),

      ...(request.previousResponseId === undefined
        ? {}
        : {
            previous_response_id: request.previousResponseId
          })
    }
  }
}

function mapModelInput(input: ModelInput): Record<string, unknown> {
  if (input.type === 'tool_result') {
    return {
      type: 'function_call_output',
      call_id: input.callId,
      output: input.output
    }
  }

  return {
    role: input.role,
    content: input.content
  }
}

function mapModelTool(tool: ModelTool): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema),
    strict: true
  }
}

function parseOpenAiResponse<TOutput>(
  request: ModelRequest<TOutput>,
  payload: unknown,
  durationMs: number
): ModelResult<TOutput> {
  if (!isRecord(payload)) {
    throw invalidResponse(
      'OpenAI returned a non-object response',
      durationMs
    )
  }

  const outputItems = payload.output

  if (!Array.isArray(outputItems)) {
    throw invalidResponse(
      'OpenAI response does not contain an output array',
      durationMs
    )
  }

  const toolCalls = parseToolCalls(
    outputItems,
    request.tools ?? [],
    durationMs
  )

  const outputText = readOutputText(outputItems)
  const usage = parseTokenUsage(payload.usage, durationMs)
  const responseId =
    typeof payload.id === 'string' ? payload.id : undefined

  let output: TOutput | undefined

  if (outputText !== undefined) {
    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(outputText)
    } catch (error) {
      throw new ModelProviderError(
        'OpenAI structured output is not valid JSON',
        {
          code: ModelProviderErrorCode.invalid_response,
          retryable: true,
          durationMs,
          cause: error
        }
      )
    }

    const validationResult = request.outputSchema.safeParse(parsedJson)

    if (!validationResult.success) {
      throw new ModelProviderError(
        `OpenAI structured output failed schema validation: ${z.prettifyError(validationResult.error)}`,
        {
          code: ModelProviderErrorCode.invalid_response,
          retryable: true,
          durationMs,
          cause: validationResult.error
        }
      )
    }

    output = validationResult.data
  }

  if (output === undefined && toolCalls.length === 0) {
    throw invalidResponse(
      'OpenAI returned neither structured output nor tool calls',
      durationMs
    )
  }

  return {
    ...(output === undefined ? {} : { output }),
    toolCalls,
    usage,
    durationMs,
    ...(responseId === undefined ? {} : { responseId })
  }
}

function parseToolCalls(
  outputItems: readonly unknown[],
  tools: readonly ModelTool[],
  durationMs: number
): ModelToolCall[] {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))
  const toolCalls: ModelToolCall[] = []

  for (const item of outputItems) {
    if (!isRecord(item) || item.type !== 'function_call') {
      continue
    }

    if (
      typeof item.call_id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.arguments !== 'string'
    ) {
      throw invalidResponse(
        'OpenAI returned a malformed function call',
        durationMs
      )
    }

    const tool = toolsByName.get(item.name)

    if (tool === undefined) {
      throw invalidResponse(
        `OpenAI requested unknown tool: ${item.name}`,
        durationMs
      )
    }

    let parsedArguments: unknown

    try {
      parsedArguments = JSON.parse(item.arguments)
    } catch (error) {
      throw new ModelProviderError(
        `OpenAI returned invalid arguments for tool ${item.name}`,
        {
          code: ModelProviderErrorCode.invalid_response,
          retryable: true,
          durationMs,
          cause: error
        }
      )
    }

    const validationResult = tool.inputSchema.safeParse(parsedArguments)

    if (!validationResult.success) {
      throw new ModelProviderError(
        `Arguments for tool ${item.name} failed schema validation: ${z.prettifyError(validationResult.error)}`,
        {
          code: ModelProviderErrorCode.invalid_response,
          retryable: true,
          durationMs,
          cause: validationResult.error
        }
      )
    }

    toolCalls.push({
      id: item.call_id,
      name: item.name,
      arguments: validationResult.data
    })
  }

  return toolCalls
}

function readOutputText(
  outputItems: readonly unknown[]
): string | undefined {
  const textParts: string[] = []

  for (const item of outputItems) {
    if (!isRecord(item) || item.type !== 'message') {
      continue
    }

    if (!Array.isArray(item.content)) {
      continue
    }

    for (const contentItem of item.content) {
      if (
        isRecord(contentItem) &&
        contentItem.type === 'output_text' &&
        typeof contentItem.text === 'string'
      ) {
        textParts.push(contentItem.text)
      }
    }
  }

  if (textParts.length === 0) {
    return undefined
  }

  return textParts.join('')
}

function parseTokenUsage(
  value: unknown,
  durationMs: number
): ModelTokenUsage {
  if (!isRecord(value)) {
    throw invalidResponse(
      'OpenAI response does not contain token usage',
      durationMs
    )
  }

  const inputTokens = value.input_tokens
  const outputTokens = value.output_tokens
  const totalTokens = value.total_tokens

  if (
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    typeof totalTokens !== 'number'
  ) {
    throw invalidResponse(
      'OpenAI returned malformed token usage',
      durationMs
    )
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens
  }
}

function mapOpenAiHttpError(
  statusCode: number,
  payload: unknown,
  durationMs: number
): ModelProviderError {
  const message = readOpenAiErrorMessage(payload)

  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError(message, {
      code: ModelProviderErrorCode.authentication,
      retryable: false,
      statusCode,
      durationMs
    })
  }

  if (statusCode === 408) {
    return new ModelProviderError(message, {
      code: ModelProviderErrorCode.timeout,
      retryable: true,
      statusCode,
      durationMs
    })
  }

  if (statusCode === 429) {
    return new ModelProviderError(message, {
      code: ModelProviderErrorCode.rate_limit,
      retryable: true,
      statusCode,
      durationMs
    })
  }

  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return new ModelProviderError(message, {
      code: ModelProviderErrorCode.invalid_request,
      retryable: false,
      statusCode,
      durationMs
    })
  }

  if (statusCode >= 500) {
    return new ModelProviderError(message, {
      code: ModelProviderErrorCode.server,
      retryable: true,
      statusCode,
      durationMs
    })
  }

  return new ModelProviderError(message, {
    code: ModelProviderErrorCode.unknown,
    retryable: false,
    statusCode,
    durationMs
  })
}

function readOpenAiErrorMessage(payload: unknown): string {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message
  }

  return 'OpenAI API request failed'
}

function invalidResponse(
  message: string,
  durationMs: number
): ModelProviderError {
  return new ModelProviderError(message, {
    code: ModelProviderErrorCode.invalid_response,
    retryable: true,
    durationMs
  })
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
