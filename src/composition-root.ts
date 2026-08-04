import type { Application } from '~/app'
import type { Cli } from '~/core/cli'
import type { InvestigatorAgent } from '~/core/investigation'
import type { Logger, LogLevel } from '~/core/logging'
import type { ModelProvider } from '~/core/model'
import type { ProcessRunnerFactory } from '~/core/process'
import type { PromptRegistry } from '~/core/prompt'
import type {
  RepositoryToolsFactory,
  WorkspaceManager
} from '~/core/workspace'

import path from 'node:path'
import { createApp } from '~/app'
import { ModelInvestigatorAgent } from '~/application/investigator'
import { RunCommandHandler, RunService } from '~/application/run'
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
import { createPinoLogger } from '~/infra/logging'
import { OpenAiModelProvider } from '~/infra/openai'
import {
  FileProcessResultStore,
  NpmProcessRunnerFactory
} from '~/infra/process'
import { FilePromptRegistry } from '~/infra/prompt'
import { FileRunStore } from '~/infra/run'
import { JsonlTraceWriter } from '~/infra/trace'
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

  constructor() {
    this.config = new AppConfig(env)

    this.workspaceManager = new GitWorkspaceManager({
      runsRoot: this.config.environment.RUNS_ROOT
    })

    this.repositoryToolsFactory = new GitRepositoryToolsFactory()

    const processResultStore = new FileProcessResultStore(
      this.config.environment.RUNS_ROOT
    )

    this.processRunnerFactory = new NpmProcessRunnerFactory({
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
      runsRoot: this.config.environment.RUNS_ROOT
    })

    this.traceRecorder = new TraceRecorder(traceWriter)

    this.investigatorAgent = new ModelInvestigatorAgent(
      this.modelProvider,
      this.promptRegistry,
      this.repositoryToolsFactory,
      this.traceRecorder,
      this.logger
    )

    const output = new ConsoleOutput()

    const runStore = new FileRunStore(this.config.environment.RUNS_ROOT)

    const runService = new RunService(runStore)

    const repositoryValidator = new GitTargetRepositoryValidator()

    const approvalPrompt = new ReadlineApprovalPrompt()

    const runCommandHandler = new RunCommandHandler(
      runService,
      repositoryValidator,
      this.workspaceManager,
      approvalPrompt,
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
      workspaceManager: this.workspaceManager
    })
  }
}
