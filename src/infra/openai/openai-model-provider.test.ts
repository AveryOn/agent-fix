/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ModelProviderError } from '~/core/model'
import { OpenAiModelProvider } from '~/infra/openai'

const outputSchema = z.object({
  hypothesis: z.string()
})

function createProvider(
  fetchImplementation: typeof fetch
): OpenAiModelProvider {
  return new OpenAiModelProvider({
    apiKey: 'test-api-key',
    model: 'test-model',
    timeoutMs: 1000,
    fetchImplementation
  })
}

describe('OpenAiModelProvider', () => {
  it('returns validated structured output and token usage', async () => {
    const fetchImplementation = (async () =>
      new Response(
        JSON.stringify({
          id: 'response-001',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    hypothesis: 'Duplicate events are not deduplicated'
                  })
                }
              ]
            }
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )) as typeof fetch

    const provider = createProvider(fetchImplementation)

    const result = await provider.generate({
      input: [
        {
          type: 'message',
          role: 'user',
          content: 'Investigate the duplicate payment bug'
        }
      ],
      outputSchemaName: 'investigation_result',
      outputSchema
    })

    expect(result.output).toEqual({
      hypothesis: 'Duplicate events are not deduplicated'
    })

    expect(result.responseId).toBe('response-001')

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120
    })

    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.toolCalls).toEqual([])
  })

  it('returns validated tool calls', async () => {
    const fetchImplementation = (async () =>
      new Response(
        JSON.stringify({
          id: 'response-002',
          output: [
            {
              type: 'function_call',
              call_id: 'call-001',
              name: 'readFile',
              arguments: JSON.stringify({
                path: 'src/payment-service.ts'
              })
            }
          ],
          usage: {
            input_tokens: 50,
            output_tokens: 10,
            total_tokens: 60
          }
        }),
        {
          status: 200
        }
      )) as typeof fetch

    const provider = createProvider(fetchImplementation)

    const result = await provider.generate({
      input: [
        {
          type: 'message',
          role: 'user',
          content: 'Inspect the payment service'
        }
      ],
      outputSchemaName: 'investigation_result',
      outputSchema,
      tools: [
        {
          name: 'readFile',
          description: 'Read a repository file',
          inputSchema: z.object({
            path: z.string().min(1)
          })
        }
      ]
    })

    expect(result.output).toBeUndefined()

    expect(result.toolCalls).toEqual([
      {
        id: 'call-001',
        name: 'readFile',
        arguments: {
          path: 'src/payment-service.ts'
        }
      }
    ])
  })

  it('maps rate limits to a retryable application error', async () => {
    const fetchImplementation = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Rate limit exceeded'
          }
        }),
        {
          status: 429
        }
      )) as typeof fetch

    const provider = createProvider(fetchImplementation)

    const promise = provider.generate({
      input: [
        {
          type: 'message',
          role: 'user',
          content: 'Test'
        }
      ],
      outputSchemaName: 'test_result',
      outputSchema
    })

    await expect(promise).rejects.toMatchObject({
      name: 'ModelProviderError',
      code: 'rate_limit',
      retryable: true,
      statusCode: 429
    })
  })

  it('rejects structured output that does not match the schema', async () => {
    const fetchImplementation = (async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    wrongField: true
                  })
                }
              ]
            }
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15
          }
        }),
        {
          status: 200
        }
      )) as typeof fetch

    const provider = createProvider(fetchImplementation)

    try {
      await provider.generate({
        input: [
          {
            type: 'message',
            role: 'user',
            content: 'Test'
          }
        ],
        outputSchemaName: 'test_result',
        outputSchema
      })

      throw new Error('Expected generate() to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProviderError)
      expect(error).toMatchObject({
        code: 'invalid_response',
        retryable: true
      })
    }
  })
})
