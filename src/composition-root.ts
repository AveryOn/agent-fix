import type { Application } from '~/app'
import type { Cli } from '~/core/cli'
import type { ImplementerAgent } from '~/core/implementation'
import type { InvestigatorAgent } from '~/core/investigation'
import type { Logger, LogLevel } from '~/core/logging'
import type { ModelProvider } from '~/core/model'
import type { ProcessRunnerFactory } from '~/core/process'
import type { PromptRegistry } from '~/core/prompt'
import type { ReproducerAgent } from '~/core/reproduction'
import type { ReviewerAgent } from '~/core/review'
import type { ValidationService } from '~/core/validation'
import type {
  RepositoryToolsFactory,
  WorkspaceManager
} from '~/core/workspace'

import path from 'node:path'
import { createApp } from '~/app'
import {
  ImplementationRetryRecovery,
  RetryExecutor,
  StepExecutor
} from '~/application/execution'
import { ModelImplementerAgent } from '~/application/implementer'
import { ModelInvestigatorAgent } from '~/application/investigator'
import { PipelineOrchestrator } from '~/application/orchestrator'
import { ModelReproducerAgent } from '~/application/reproducer'
import { ModelReviewerAgent } from '~/application/reviewer'
import { RunCommandHandler, RunService } from '~/application/run'
import { DeterministicValidationService } from '~/application/validation'
import { AppConfig } from '~/core/config'
import { AgentContextManager } from '~/core/context'
import { TraceRecorder } from '~/core/trace'
import { env } from '~/env'
import {
  AgentFixCli,
  ConsoleOutput,
  GitTargetRepositoryValidator,
  ReadlineApprovalPrompt
} from '~/infra/cli'
import { FileStepCheckpointStore } from '~/infra/execution'
import { FileImplementationArtifactStore } from '~/infra/implementation'
import { createPinoLogger } from '~/infra/logging'
import { OpenAiModelProvider } from '~/infra/openai'
import { FileFinalRunArtifactStore } from '~/infra/orchestrator'
import {
  DockerProcessRunnerFactory,
  FileProcessResultStore,
  NpmProcessRunnerFactory
} from '~/infra/process'
import { FilePromptRegistry } from '~/infra/prompt'
import { FileReproductionArtifactStore } from '~/infra/reproduction'
import { FileReviewArtifactStore } from '~/infra/review'
import { FileRunStore } from '~/infra/run'
import { JsonlTraceWriter } from '~/infra/trace'
import { FileValidationReportStore } from '~/infra/validation'
import {
  GitRepositoryToolsFactory,
  GitWorkspaceManager
} from '~/infra/workspace'

export class CompositionRoot {
  readonly app: Application
  readonly cli: Cli
  readonly config: AppConfig
  readonly logger: Logger
  readonly modelProvider: ModelProvider
  readonly processRunnerFactory: ProcessRunnerFactory
  readonly promptRegistry: PromptRegistry
  readonly investigatorAgent: InvestigatorAgent
  readonly traceRecorder: TraceRecorder
  readonly contextManager: AgentContextManager
  readonly workspaceManager: WorkspaceManager
  readonly repositoryToolsFactory: RepositoryToolsFactory
  readonly reproducerAgent: ReproducerAgent
  readonly implementerAgent: ImplementerAgent
  readonly reviewerAgent: ReviewerAgent
  readonly validationService: ValidationService

  constructor() {
    this.config = new AppConfig(env)

    const runsRoot = this.config.environment.RUNS_ROOT

    this.workspaceManager = new GitWorkspaceManager({
      runsRoot
    })

    this.repositoryToolsFactory = new GitRepositoryToolsFactory()

    const processResultStore = new FileProcessResultStore(runsRoot)

    this.processRunnerFactory = this.config.environment.DOCKER_ENABLED
      ? new DockerProcessRunnerFactory({
          image: this.config.environment.DOCKER_IMAGE,
          commandTimeoutMs: this.config.environment.COMMAND_TIMEOUT_MS,
          memoryMb: this.config.environment.DOCKER_MEMORY_MB,
          cpus: this.config.environment.DOCKER_CPUS,
          pidsLimit: this.config.environment.DOCKER_PIDS_LIMIT,
          resultStore: processResultStore
        })
      : new NpmProcessRunnerFactory({
          commandTimeoutMs: this.config.environment.COMMAND_TIMEOUT_MS,
          resultStore: processResultStore
        })

    this.promptRegistry = new FilePromptRegistry({
      promptsRoot: path.resolve('prompts')
    })

    this.contextManager = new AgentContextManager({
      tokenBudget: this.config.environment.CONTEXT_TOKEN_BUDGET
    })

    this.logger = createPinoLogger({
      level: this.config.environment.LOG_LEVEL as LogLevel,
      pretty: this.config.environment.LOG_PRETTY,
      serviceName: 'AgentFix'
    })

    this.modelProvider = new OpenAiModelProvider({
      apiKey: this.config.environment.OPENAI_API_KEY,
      model: this.config.environment.OPENAI_MODEL,
      timeoutMs: this.config.environment.OPENAI_TIMEOUT_MS
    })

    const traceWriter = new JsonlTraceWriter({
      runsRoot
    })

    this.traceRecorder = new TraceRecorder(traceWriter)

    this.investigatorAgent = new ModelInvestigatorAgent(
      this.modelProvider,
      this.promptRegistry,
      this.repositoryToolsFactory,
      this.traceRecorder,
      this.logger
    )

    const reproductionArtifactStore = new FileReproductionArtifactStore(
      runsRoot
    )

    this.reproducerAgent = new ModelReproducerAgent(
      this.modelProvider,
      this.promptRegistry,
      this.repositoryToolsFactory,
      this.processRunnerFactory,
      reproductionArtifactStore,
      this.traceRecorder,
      this.logger
    )

    const implementationArtifactStore =
      new FileImplementationArtifactStore(runsRoot)

    this.implementerAgent = new ModelImplementerAgent(
      this.modelProvider,
      this.promptRegistry,
      this.repositoryToolsFactory,
      this.processRunnerFactory,
      implementationArtifactStore,
      this.traceRecorder,
      this.logger
    )

    const reviewArtifactStore = new FileReviewArtifactStore(runsRoot)

    this.reviewerAgent = new ModelReviewerAgent(
      this.modelProvider,
      this.promptRegistry,
      reviewArtifactStore,
      this.traceRecorder,
      this.logger
    )

    const validationReportStore = new FileValidationReportStore(runsRoot)

    this.validationService = new DeterministicValidationService(
      this.repositoryToolsFactory,
      this.processRunnerFactory,
      validationReportStore,
      this.traceRecorder,
      this.logger
    )

    const output = new ConsoleOutput()

    const runStore = new FileRunStore(runsRoot)

    const runService = new RunService(runStore)

    const repositoryValidator = new GitTargetRepositoryValidator()

    const approvalPrompt = new ReadlineApprovalPrompt()

    const retryExecutor = new RetryExecutor(
      this.config.environment.MAX_AGENT_ATTEMPTS
    )

    const checkpointStore = new FileStepCheckpointStore(runsRoot)

    const stepExecutor = new StepExecutor(checkpointStore)

    const implementationRecovery = new ImplementationRetryRecovery(
      this.workspaceManager,
      this.repositoryToolsFactory
    )

    const finalArtifactStore = new FileFinalRunArtifactStore(runsRoot)

    const pipelineOrchestrator = new PipelineOrchestrator({
      runService,
      contextManager: this.contextManager,
      investigatorAgent: this.investigatorAgent,
      reproducerAgent: this.reproducerAgent,
      implementerAgent: this.implementerAgent,
      validationService: this.validationService,
      reviewerAgent: this.reviewerAgent,
      workspaceManager: this.workspaceManager,
      repositoryToolsFactory: this.repositoryToolsFactory,
      approvalPrompt,
      finalArtifactStore,
      retryExecutor,
      stepExecutor,
      implementationRecovery,
      traceRecorder: this.traceRecorder,
      logger: this.logger
    })

    const runCommandHandler = new RunCommandHandler(
      runService,
      repositoryValidator,
      this.workspaceManager,
      pipelineOrchestrator,
      output,
      this.logger,
      this.traceRecorder
    )

    this.cli = new AgentFixCli(runCommandHandler, output, this.logger)

    this.app = createApp({
      cli: this.cli,
      config: this.config,
      logger: this.logger,
      modelProvider: this.modelProvider,
      processRunnerFactory: this.processRunnerFactory,
      promptRegistry: this.promptRegistry,
      investigatorAgent: this.investigatorAgent,
      traceRecorder: this.traceRecorder,
      contextManager: this.contextManager,
      repositoryToolsFactory: this.repositoryToolsFactory,
      workspaceManager: this.workspaceManager,
      reproducerAgent: this.reproducerAgent,
      implementerAgent: this.implementerAgent,
      reviewerAgent: this.reviewerAgent,
      validationService: this.validationService
    })
  }
}
