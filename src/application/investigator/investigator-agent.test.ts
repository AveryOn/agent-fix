/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  InvestigationInput,
  InvestigationResult
} from '~/core/investigation'
import type {
  ModelProvider,
  ModelRequest,
  ModelResult
} from '~/core/model'
import type {
  AgentPrompt,
  PromptRegistry,
  PromptVersion,
  PromptVersionSnapshot
} from '~/core/prompt'
import type { TraceEvent, TraceWriter } from '~/core/trace'
import type {
  ApplyPatchResult,
  CodeSearchMatch,
  ReadRepositoryFileResult,
  RepositoryFile,
  RepositoryTools,
  RepositoryToolsFactory,
  SearchCodeInput
} from '~/core/workspace'

import { describe, expect, it } from 'vitest'
import { ModelInvestigatorAgent } from '~/application/investigator'
import { AgentRole } from '~/core/context'
import {
  InvestigatorErrorCode,
  investigationEvidenceArtifactId
} from '~/core/investigation'
import { LogLevel } from '~/core/logging'
import { TraceEventType, TraceRecorder } from '~/core/trace'
import { createPinoLogger } from '~/infra/logging'

const workspaceRevision = 'sha256:revision-001'

describe('ModelInvestigatorAgent', () => {
  it('executes the repository tool loop and returns grounded evidence', async () => {
    const repositoryTools = createRepositoryTools()

    const modelProvider = new ScriptedModelProvider([
      createModelResult({
        toolCalls: [
          {
            id: 'call-list',
            name: 'listFiles',
            arguments: {}
          },
          {
            id: 'call-search',
            name: 'searchCode',
            arguments: {
              query: 'createPayment',
              caseSensitive: null,
              maxResults: null
            }
          },
          {
            id: 'call-read',
            name: 'readFile',
            arguments: {
              path: 'src/payment-service.ts',
              lineStart: 1,
              lineEnd: 3
            }
          }
        ],
        responseId: 'response-001'
      }),

      createModelResult({
        output: createInvestigationResult()
      })
    ])

    const traceWriter = new MemoryTraceWriter()

    const agent = createAgent(modelProvider, repositoryTools, traceWriter)

    const result = await agent.execute(createInput())

    expect(result).toEqual(createInvestigationResult())

    expect(modelProvider.requests).toHaveLength(2)

    expect(modelProvider.requests[1]?.previousResponseId).toBe(
      'response-001'
    )

    expect(
      modelProvider.requests[1]?.input.map((item) => item.type)
    ).toEqual(['tool_result', 'tool_result', 'tool_result'])

    expect(traceWriter.events.map((event) => event.type)).toEqual([
      TraceEventType.agent_call,
      TraceEventType.tool_call,
      TraceEventType.tool_result,
      TraceEventType.tool_call,
      TraceEventType.tool_result,
      TraceEventType.tool_call,
      TraceEventType.tool_result,
      TraceEventType.agent_call,
      TraceEventType.agent_result
    ])

    expect(
      traceWriter.events.every(
        (event) => event.promptVersion === 'investigator-v1'
      )
    ).toBe(true)
  })

  it('rejects a hallucinated file reference', async () => {
    const result = createInvestigationResult({
      relatedFiles: ['src/missing.ts'],
      evidence: [
        {
          ...getFirstEvidence(createInvestigationResult()),
          filePath: 'src/missing.ts'
        }
      ]
    })

    const agent = createAgent(
      new ScriptedModelProvider([
        createModelResult({
          output: result
        })
      ]),
      createRepositoryTools(),
      new MemoryTraceWriter()
    )

    await expect(agent.execute(createInput())).rejects.toMatchObject({
      code: InvestigatorErrorCode.hallucinated_file,
      retryable: true
    })
  })

  it('rejects a hallucinated symbol reference', async () => {
    const original = createInvestigationResult()

    const result = createInvestigationResult({
      hypothesis: 'missingPaymentFunction creates duplicate payments',
      evidence: [
        {
          ...getFirstEvidence(original),
          symbol: 'missingPaymentFunction'
        }
      ]
    })

    const agent = createAgent(
      new ScriptedModelProvider([
        createModelResult({
          output: result
        })
      ]),
      createRepositoryTools(),
      new MemoryTraceWriter()
    )

    await expect(agent.execute(createInput())).rejects.toMatchObject({
      code: InvestigatorErrorCode.hallucinated_symbol,
      retryable: true
    })
  })

  it('accepts grounded evidence without a symbol', async () => {
    const original = createInvestigationResult()

    const result = createInvestigationResult({
      hypothesis:
        'The payment creation logic does not check whether the provider event was already processed.',
      evidence: [
        {
          ...getFirstEvidence(original),
          symbol: null
        }
      ]
    })

    const agent = createAgent(
      new ScriptedModelProvider([
        createModelResult({
          output: result
        })
      ]),
      createRepositoryTools(),
      new MemoryTraceWriter()
    )

    await expect(agent.execute(createInput())).resolves.toEqual(result)
  })

  it('rejects a stale investigation result', async () => {
    const result = createInvestigationResult({
      workspaceRevision: 'sha256:old-revision',
      evidence: [
        {
          ...getFirstEvidence(createInvestigationResult()),
          workspaceRevision: 'sha256:old-revision'
        }
      ]
    })

    const agent = createAgent(
      new ScriptedModelProvider([
        createModelResult({
          output: result
        })
      ]),
      createRepositoryTools(),
      new MemoryTraceWriter()
    )

    await expect(agent.execute(createInput())).rejects.toMatchObject({
      code: InvestigatorErrorCode.stale_workspace,
      retryable: true
    })
  })

  it('rejects tools outside the investigator allowlist', async () => {
    const agent = createAgent(
      new ScriptedModelProvider([
        createModelResult({
          toolCalls: [
            {
              id: 'call-shell',
              name: 'exec',
              arguments: {
                command: 'rm -rf .'
              }
            }
          ],
          responseId: 'response-001'
        })
      ]),
      createRepositoryTools(),
      new MemoryTraceWriter()
    )

    await expect(agent.execute(createInput())).rejects.toMatchObject({
      code: InvestigatorErrorCode.unsupported_tool,
      retryable: false
    })
  })
  it('disables tools after the interactive tool budget is exhausted', async () => {
    const toolResult = createModelResult({
      toolCalls: [
        {
          id: 'call-list',
          name: 'listFiles',
          arguments: {}
        }
      ],
      responseId: 'response-tool'
    })

    const results = Array.from({ length: 12 }, () => toolResult)

    results.push(
      createModelResult({
        output: createInvestigationResult(),
        responseId: 'response-final'
      })
    )

    const modelProvider = new ScriptedModelProvider(results)

    const agent = createAgent(
      modelProvider,
      createRepositoryTools(),
      new MemoryTraceWriter()
    )

    const result = await agent.execute(createInput())

    expect(result).toEqual(createInvestigationResult())
    expect(modelProvider.requests).toHaveLength(13)
    expect(modelProvider.requests[11]?.tools).toBeDefined()
    expect(modelProvider.requests[12]?.tools).toEqual([])
  })
})

class ScriptedModelProvider implements ModelProvider {
  readonly requests: ModelRequest<unknown>[] = []

  private readonly results: ModelResult<InvestigationResult>[]

  constructor(results: readonly ModelResult<InvestigationResult>[]) {
    this.results = [...results]
  }

  generate<TOutput>(
    request: ModelRequest<TOutput>
  ): Promise<ModelResult<TOutput>> {
    this.requests.push(request)

    const result = this.results.shift()

    if (result === undefined) {
      return Promise.reject(new Error('No scripted model result remains'))
    }

    return Promise.resolve(result as unknown as ModelResult<TOutput>)
  }
}

class StaticPromptRegistry implements PromptRegistry {
  private readonly prompt: AgentPrompt = {
    id: 'investigator-v1',
    agent: AgentRole.investigator,
    version: 'v1',
    content: 'Investigate the repository.',
    sourcePath: 'investigator/v1.md'
  }

  load(agent: AgentRole, _version?: PromptVersion): Promise<AgentPrompt> {
    if (agent !== AgentRole.investigator) {
      return Promise.reject(new Error(`Unexpected prompt agent: ${agent}`))
    }

    return Promise.resolve(this.prompt)
  }

  loadAll(): Promise<readonly AgentPrompt[]> {
    return Promise.resolve([this.prompt])
  }

  getVersionSnapshot(): Promise<PromptVersionSnapshot> {
    return Promise.resolve({
      investigator: 'investigator-v1',
      reproducer: 'reproducer-v1',
      implementer: 'implementer-v1',
      reviewer: 'reviewer-v1'
    })
  }
}

class MemoryTraceWriter implements TraceWriter {
  readonly events: TraceEvent[] = []

  write(event: TraceEvent): Promise<void> {
    this.events.push(event)

    return Promise.resolve()
  }

  flush(): Promise<void> {
    return Promise.resolve()
  }
}

class MemoryRepositoryTools implements RepositoryTools {
  constructor(
    private readonly files: ReadonlyMap<string, string>,
    private readonly revision: string
  ) {}

  listFiles(): Promise<readonly RepositoryFile[]> {
    return Promise.resolve(
      [...this.files.entries()].map(([filePath, content]) => ({
        path: filePath,
        sizeBytes: Buffer.byteLength(content)
      }))
    )
  }

  searchCode(input: SearchCodeInput): Promise<readonly CodeSearchMatch[]> {
    const matches: CodeSearchMatch[] = []
    const query = input.caseSensitive
      ? input.query
      : input.query.toLowerCase()

    for (const [filePath, content] of this.files) {
      const lines = content.split(/\r?\n/)

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ''

        const searchableLine = input.caseSensitive
          ? line
          : line.toLowerCase()

        const column = searchableLine.indexOf(query)

        if (column === -1) {
          continue
        }

        matches.push({
          path: filePath,
          line: index + 1,
          column: column + 1,
          preview: line
        })
      }
    }

    return Promise.resolve(matches)
  }

  readFile(relativePath: string): Promise<ReadRepositoryFileResult> {
    const content = this.files.get(relativePath)

    if (content === undefined) {
      return Promise.reject(
        new Error(`Missing fixture file: ${relativePath}`)
      )
    }

    return Promise.resolve({
      path: relativePath,
      sizeBytes: Buffer.byteLength(content),
      content
    })
  }

  applyPatch(_patch: string): Promise<ApplyPatchResult> {
    return Promise.reject(
      new Error('applyPatch is not available to investigator tests')
    )
  }

  async revertPatch(_patch: string): Promise<void> {}

  getDiff(): Promise<string> {
    return Promise.reject(
      new Error('getDiff is not available to investigator tests')
    )
  }

  getChangedFiles(): Promise<readonly string[]> {
    return Promise.reject(
      new Error('getChangedFiles is not available to investigator tests')
    )
  }

  getWorkspaceRevision(): Promise<string> {
    return Promise.resolve(this.revision)
  }
}

function createAgent(
  modelProvider: ModelProvider,
  repositoryTools: RepositoryTools,
  traceWriter: TraceWriter
): ModelInvestigatorAgent {
  const repositoryToolsFactory: RepositoryToolsFactory = {
    create: () => repositoryTools
  }

  return new ModelInvestigatorAgent(
    modelProvider,
    new StaticPromptRegistry(),
    repositoryToolsFactory,
    new TraceRecorder(traceWriter),
    createPinoLogger({
      level: LogLevel.silent,
      pretty: false
    })
  )
}

function createRepositoryTools(): RepositoryTools {
  return new MemoryRepositoryTools(
    new Map([
      [
        'src/payment-service.ts',
        [
          'export function createPayment(eventId: string) {',
          '  return payments.push({ eventId })',
          '}'
        ].join('\n')
      ],
      [
        'src/webhook-handler.ts',
        [
          'import { createPayment } from "./payment-service"',
          '',
          'export function handleWebhook(eventId: string) {',
          '  return createPayment(eventId)',
          '}'
        ].join('\n')
      ]
    ]),
    workspaceRevision
  )
}

function createInput(): InvestigationInput {
  return {
    context: {
      agent: AgentRole.investigator,
      createdAt: '2026-08-04T15:00:00.000Z',
      estimatedTokens: 100,
      context: {
        runId: 'run-001',
        task: 'Duplicate webhook delivery creates two payments',
        workspaceRevision,
        artifactIds: ['repository'],
        evidence: [],
        constraints: ['Do not modify repository files']
      }
    },

    workspace: {
      runId: 'run-001',

      repositoryPath: '/repository/fixture',
      repositoryRoot: '/repository',
      repositoryRelativePath: 'fixture',

      workspaceRoot: '/runs/run-001/workspace',
      workspacePath: '/runs/run-001/workspace/fixture',

      baseCommit: 'base-commit',
      workspaceRevision
    }
  }
}

function createInvestigationResult(
  overrides: Partial<InvestigationResult> = {}
): InvestigationResult {
  const result: InvestigationResult = {
    hypothesis:
      'createPayment inserts a payment without checking whether ' +
      'the provider event was already processed.',

    evidence: [
      {
        id: 'evidence-create-payment',
        artifactId: investigationEvidenceArtifactId,
        filePath: 'src/payment-service.ts',
        claim:
          'createPayment inserts every received event without ' +
          'an idempotency check.',
        confirmed: true,
        workspaceRevision,
        symbol: 'createPayment',
        lineStart: 1,
        lineEnd: 3
      }
    ],

    relatedFiles: ['src/payment-service.ts', 'src/webhook-handler.ts'],

    workspaceRevision
  }

  return {
    ...result,
    ...overrides
  }
}

function createModelResult(
  overrides: Partial<ModelResult<InvestigationResult>>
): ModelResult<InvestigationResult> {
  return {
    toolCalls: [],
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150
    },
    durationMs: 100,
    ...overrides
  }
}

function getFirstEvidence(
  result: InvestigationResult
): InvestigationResult['evidence'][number] {
  const evidence = result.evidence[0]

  if (evidence === undefined) {
    throw new Error('Expected investigation evidence')
  }

  return evidence
}
