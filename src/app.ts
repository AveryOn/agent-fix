import type { ImplementerAgent } from '.~/core/implementation'
import type { Cli } from '~/core/cli'
import type { AppConfig } from '~/core/config'
import type { AgentContextManager } from '~/core/context'
import type { InvestigatorAgent } from '~/core/investigation'
import type { Logger } from '~/core/logging'
import type { ModelProvider } from '~/core/model'
import type { ProcessRunnerFactory } from '~/core/process'
import type { PromptRegistry } from '~/core/prompt'
import type { ReproducerAgent } from '~/core/reproduction'
import type { TraceRecorder } from '~/core/trace'
import type {
  RepositoryToolsFactory,
  WorkspaceManager
} from '~/core/workspace'

export interface ApplicationDependencies {
  readonly config: AppConfig
  readonly modelProvider: ModelProvider
  readonly processRunnerFactory: ProcessRunnerFactory
  readonly promptRegistry: PromptRegistry
  readonly investigatorAgent: InvestigatorAgent
  readonly logger: Logger
  readonly traceRecorder: TraceRecorder
  readonly cli: Cli
  readonly contextManager: AgentContextManager
  readonly workspaceManager: WorkspaceManager
  readonly repositoryToolsFactory: RepositoryToolsFactory
  readonly reproducerAgent: ReproducerAgent
  readonly implementerAgent: ImplementerAgent
}

export interface Application {
  start(): Promise<void>
  execute(argv: readonly string[]): Promise<number>
  stop(): Promise<void>
}

type ApplicationStatus = 'created' | 'started' | 'stopped'

export function createApp(
  dependencies: ApplicationDependencies
): Application {
  let status: ApplicationStatus = 'created'

  return {
    async start(): Promise<void> {
      if (status === 'started') {
        return
      }

      if (status === 'stopped') {
        throw new Error('Application cannot be started after shutdown')
      }

      status = 'started'
    },

    execute(argv: readonly string[]): Promise<number> {
      if (status !== 'started') {
        throw new Error(
          'Application must be started before command execution'
        )
      }

      return dependencies.cli.execute(argv)
    },

    async stop(): Promise<void> {
      if (status === 'stopped') {
        return
      }

      status = 'stopped'
    }
  }
}
