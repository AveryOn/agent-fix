import type { Logger } from '~/core/logging'
import type { ModelProvider, ModelResult } from '~/core/model'
import type {
  ProcessOperationResult,
  ProcessRunnerFactory
} from '~/core/process'
import type {
  PromptRegistry,
  PromptVersionIdentifier
} from '~/core/prompt'
import type {
  ReproductionArtifactStore,
  ReproductionInput,
  ReproductionPlan,
  ReproductionResult,
  ReproducerAgent
} from '~/core/reproduction'
import type { TraceRecorder } from '~/core/trace'
import type {
  RepositoryTools,
  RepositoryToolsFactory,
  WorkspaceSnapshot
} from '~/core/workspace'

import { z } from 'zod'
import { ReproductionGate } from '~/application/reproducer/reproduction-gate'
import { ReproductionPatchValidator } from '~/application/reproducer/reproduction-patch-validator'
import { TestStructureInspector } from '~/application/reproducer/test-structure-inspector'
import { AgentRole } from '~/core/context'
import {
  ReproducerError,
  ReproducerErrorCode,
  reproductionInputSchema,
  reproductionPlanSchema
} from '~/core/reproduction'
import { TraceEventType } from '~/core/trace'

const reproducerStep = 'reproducer'

export class ModelReproducerAgent implements ReproducerAgent {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly promptRegistry: PromptRegistry,
    private readonly repositoryToolsFactory: RepositoryToolsFactory,
    private readonly processRunnerFactory: ProcessRunnerFactory,
    private readonly artifactStore: ReproductionArtifactStore,
    private readonly traceRecorder: TraceRecorder,
    private readonly logger: Logger,
    private readonly testStructureInspector = new TestStructureInspector(),
    private readonly patchValidator = new ReproductionPatchValidator(),
    private readonly reproductionGate = new ReproductionGate()
  ) {}

  async execute(input: ReproductionInput): Promise<ReproductionResult> {
    this.assertValidInput(input)

    const sourceWorkspaceRevision = input.context.context.workspaceRevision

    const logger = this.logger.child({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: AgentRole.reproducer,
      workspaceRevision: sourceWorkspaceRevision
    })

    let promptVersion: PromptVersionIdentifier | undefined

    try {
      const prompt = await this.promptRegistry.load(AgentRole.reproducer)

      promptVersion = prompt.id

      const repositoryTools = this.repositoryToolsFactory.create(
        input.workspace
      )

      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      )

      const testStructure = await this.inspectTestStructure(
        input,
        prompt.id,
        repositoryTools,
        sourceWorkspaceRevision
      )

      const modelResult = await this.modelProvider.generate({
        input: [
          {
            type: 'message',
            role: 'system',
            content: prompt.content
          },
          {
            type: 'message',
            role: 'user',
            content: JSON.stringify({
              agentContext: input.context.context,
              investigation: input.investigation,
              testStructure
            })
          }
        ],
        outputSchemaName: 'reproduction_plan',
        outputSchema: reproductionPlanSchema
      })

      await this.recordModelCall(input, prompt.id, modelResult)

      if (modelResult.toolCalls.length > 0) {
        throw new ReproducerError(
          'Reproducer returned an unexpected tool call',
          ReproducerErrorCode.unexpected_tool_call
        )
      }

      if (modelResult.output === undefined) {
        throw new ReproducerError(
          'Reproducer returned no structured output',
          ReproducerErrorCode.missing_output,
          {
            retryable: true
          }
        )
      }

      const parsedPlan = reproductionPlanSchema.parse(modelResult.output)

      const plan: ReproductionPlan = {
        ...parsedPlan,
        patch: normalizeUnifiedDiffHunks(parsedPlan.patch)
      }

      const changedFiles = this.patchValidator.validate(
        plan,

        input.investigation.workspaceRevision
      )
      await this.assertFreshWorkspace(
        repositoryTools,
        sourceWorkspaceRevision
      )

      this.logger.info('Reproducer generated patch', {
        runId: input.context.context.runId,
        step: reproducerStep,
        agent: AgentRole.reproducer,
        patch: plan.patch,
        testFiles: plan.testFiles,
        expectedFailureMarker: plan.expectedFailureMarker
      })

      const applyResult = await this.applyPatch(
        input,
        prompt.id,
        repositoryTools,
        plan
      )

      assertChangedFilesMatch(changedFiles, applyResult.changedFiles)

      const patchedWorkspace: WorkspaceSnapshot = {
        ...input.workspace,
        workspaceRevision: applyResult.workspaceRevision
      }

      const processRunner =
        this.processRunnerFactory.create(patchedWorkspace)

      const commandResult = await this.runTests(
        input,
        prompt.id,
        processRunner.runTests.bind(processRunner),
        applyResult.workspaceRevision
      )

      this.reproductionGate.assertExpectedFailure(
        commandResult,
        plan.expectedFailureMarker
      )

      const artifacts = await this.artifactStore.save({
        runId: input.context.context.runId,
        plan,
        sourceWorkspaceRevision,
        workspaceRevision: applyResult.workspaceRevision,
        commandResult
      })

      const result: ReproductionResult = {
        summary: plan.summary,
        patch: plan.patch,
        testFiles: plan.testFiles,
        expectedFailureMarker: plan.expectedFailureMarker,
        sourceWorkspaceRevision,
        workspaceRevision: applyResult.workspaceRevision,
        commandResult,
        artifacts
      }

      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reproducerStep,
        agent: AgentRole.reproducer,
        workspaceRevision: applyResult.workspaceRevision,
        type: TraceEventType.agent_result,
        promptVersion: prompt.id,
        output: {
          summary: result.summary,
          testFiles: result.testFiles,
          expectedFailureMarker: result.expectedFailureMarker,
          commandArtifact: result.commandResult.artifact,
          reproductionArtifact: result.artifacts.reproduction,
          patchArtifact: result.artifacts.patch
        }
      })

      logger.info('Reproduction confirmed', {
        testFiles: result.testFiles,
        commandExecutionId: commandResult.executionId
      })

      return result
    } catch (error) {
      await this.recordFailure(input, promptVersion, error, logger)

      logger.error('Reproduction failed', {
        error
      })

      throw error
    }
  }

  private assertValidInput(input: ReproductionInput): void {
    const result = reproductionInputSchema.safeParse(input)

    if (!result.success) {
      throw new ReproducerError(
        'Reproduction input failed schema validation: ' +
          z.prettifyError(result.error),
        ReproducerErrorCode.invalid_input,
        {
          cause: result.error
        }
      )
    }
  }

  private parsePlan(value: unknown): ReproductionPlan {
    const result = reproductionPlanSchema.safeParse(value)

    if (!result.success) {
      throw new ReproducerError(
        'Reproduction output failed schema validation: ' +
          z.prettifyError(result.error),
        ReproducerErrorCode.invalid_output,
        {
          retryable: true,
          cause: result.error
        }
      )
    }

    return result.data
  }

  private async assertFreshWorkspace(
    repositoryTools: RepositoryTools,
    expectedRevision: string
  ): Promise<void> {
    const currentRevision = await repositoryTools.getWorkspaceRevision()

    if (currentRevision !== expectedRevision) {
      throw new ReproducerError(
        'Reproducer context contains a stale workspace revision',
        ReproducerErrorCode.stale_workspace,
        {
          retryable: true
        }
      )
    }
  }

  private async inspectTestStructure(
    input: ReproductionInput,
    promptVersion: PromptVersionIdentifier,
    repositoryTools: RepositoryTools,
    workspaceRevision: string
  ) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: AgentRole.reproducer,
      workspaceRevision,
      type: TraceEventType.tool_call,
      promptVersion,
      input: {
        name: 'inspectTestStructure'
      }
    })

    const result = await this.testStructureInspector.inspect(
      repositoryTools,
      workspaceRevision
    )

    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: AgentRole.reproducer,
      workspaceRevision,
      type: TraceEventType.tool_result,
      promptVersion,
      output: {
        name: 'inspectTestStructure',
        framework: result.framework,
        testScript: result.testScript,
        configFiles: result.configFiles.map((file) => file.path),
        testFiles: result.testFiles.map((file) => file.path)
      }
    })

    return result
  }

  private async applyPatch(
    input: ReproductionInput,
    promptVersion: PromptVersionIdentifier,
    repositoryTools: RepositoryTools,
    plan: ReproductionPlan
  ) {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: AgentRole.reproducer,
      workspaceRevision: input.workspace.workspaceRevision,
      type: TraceEventType.tool_call,
      promptVersion,
      input: {
        name: 'applyReproductionPatch',
        testFiles: plan.testFiles
      }
    })

    try {
      const result = await repositoryTools.applyPatch(plan.patch)

      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reproducerStep,
        agent: AgentRole.reproducer,
        workspaceRevision: result.workspaceRevision,
        type: TraceEventType.tool_result,
        promptVersion,
        output: {
          name: 'applyReproductionPatch',
          changedFiles: result.changedFiles,
          workspaceRevision: result.workspaceRevision
        }
      })

      return result
    } catch (error) {
      throw new ReproducerError(
        'Failed to apply reproduction test patch',
        ReproducerErrorCode.patch_application_failed,
        {
          retryable: true,
          cause: error
        }
      )
    }
  }

  private async runTests(
    input: ReproductionInput,
    promptVersion: PromptVersionIdentifier,
    runTests: () => Promise<ProcessOperationResult>,
    workspaceRevision: string
  ): Promise<ProcessOperationResult> {
    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: AgentRole.reproducer,
      workspaceRevision,
      type: TraceEventType.tool_call,
      promptVersion,
      input: {
        name: 'runTests'
      }
    })

    const result = await runTests()

    await this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: AgentRole.reproducer,
      workspaceRevision,
      type: TraceEventType.tool_result,
      promptVersion,
      durationMs: result.durationMs,
      output: {
        name: 'runTests',
        executionId: result.executionId,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        succeeded: result.succeeded,
        artifact: result.artifact
      }
    })

    return result
  }

  private recordModelCall(
    input: ReproductionInput,
    promptVersion: PromptVersionIdentifier,
    result: ModelResult<ReproductionPlan>
  ): Promise<void> {
    return this.traceRecorder.record({
      runId: input.context.context.runId,
      step: reproducerStep,
      agent: AgentRole.reproducer,
      workspaceRevision: input.workspace.workspaceRevision,
      type: TraceEventType.agent_call,
      promptVersion,
      durationMs: result.durationMs,
      tokenUsage: result.usage,
      output: {
        returnedStructuredOutput: result.output !== undefined,
        toolCalls: result.toolCalls.map((toolCall) => toolCall.name)
      }
    })
  }

  private async recordFailure(
    input: ReproductionInput,
    promptVersion: PromptVersionIdentifier | undefined,
    error: unknown,
    logger: Logger
  ): Promise<void> {
    try {
      await this.traceRecorder.record({
        runId: input.context.context.runId,
        step: reproducerStep,
        agent: AgentRole.reproducer,
        workspaceRevision: input.context.context.workspaceRevision,
        type: TraceEventType.failure,
        error: toTraceError(error),

        ...(promptVersion === undefined
          ? {}
          : {
              promptVersion
            })
      })
    } catch (traceError) {
      logger.warn('Failed to record reproducer failure', {
        traceError
      })
    }
  }
}

function assertChangedFilesMatch(
  expectedFiles: readonly string[],
  actualFiles: readonly string[]
): void {
  const expected = [...expectedFiles].sort()
  const actual = [...actualFiles].sort()

  if (expected.length !== actual.length) {
    throw new ReproducerError(
      'Applied patch changed unexpected files',
      ReproducerErrorCode.changed_files_mismatch
    )
  }

  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== actual[index]) {
      throw new ReproducerError(
        'Applied patch changed unexpected files',
        ReproducerErrorCode.changed_files_mismatch
      )
    }
  }
}

function toTraceError(error: unknown): {
  name: string
  message: string
  code?: string
  retryable?: boolean
} {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      message: 'Unknown reproducer failure'
    }
  }

  const result: {
    name: string
    message: string
    code?: string
    retryable?: boolean
  } = {
    name: error.name,
    message: error.message
  }

  if ('code' in error && typeof error.code === 'string') {
    result.code = error.code
  }

  if ('retryable' in error && typeof error.retryable === 'boolean') {
    result.retryable = error.retryable
  }

  return result
}

function normalizeUnifiedDiffHunks(patch: string): string {
  const lines = patch.split(/\r?\n/)
  const result: string[] = []

  let hunkHeaderIndex: number | null = null
  let oldStart = 0
  let newStart = 0
  let oldCount = 0
  let newCount = 0

  const flushHunk = (): void => {
    if (hunkHeaderIndex === null) {
      return
    }

    result[hunkHeaderIndex] =
      `@@ -${oldStart},${oldCount} ` + `+${newStart},${newCount} @@`

    hunkHeaderIndex = null
    oldCount = 0
    newCount = 0
  }

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)

    if (hunkMatch !== null) {
      flushHunk()

      oldStart = Number(hunkMatch[1])
      newStart = Number(hunkMatch[2])

      hunkHeaderIndex = result.length
      result.push(line)

      continue
    }

    if (hunkHeaderIndex !== null && line.startsWith('diff --git ')) {
      flushHunk()
    }

    if (hunkHeaderIndex !== null) {
      if (line.startsWith('+')) {
        newCount += 1
        result.push(line)
        continue
      }

      if (line.startsWith('-')) {
        oldCount += 1
        result.push(line)
        continue
      }

      if (line.startsWith(' ')) {
        oldCount += 1
        newCount += 1
        result.push(line)
        continue
      }

      if (line === '\\ No newline at end of file') {
        result.push(line)
        continue
      }

      if (oldStart === 0) {
        newCount += 1
        result.push(`+${line}`)
        continue
      }
    }

    result.push(line)
  }

  flushHunk()

  return `${result.join('\n').replace(/\n+$/u, '')}\n`
}
