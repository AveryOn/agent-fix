import type { Application } from '~/app'
import type { Logger, LogLevel } from '~/core/logging'
import type { ModelProvider } from '~/core/model'

import { createApp } from '~/app'
import { AppConfig } from '~/core/config'
import { TraceRecorder } from '~/core/trace'
import { env } from '~/env'
import { createPinoLogger } from '~/infra/logging'
import { OpenAiModelProvider } from '~/infra/openai'
import { JsonlTraceWriter } from '~/infra/trace'

export class CompositionRoot {
  readonly app: Application
  readonly config: AppConfig
  readonly logger: Logger
  readonly modelProvider: ModelProvider
  readonly traceRecorder: TraceRecorder

  constructor() {
    this.config = new AppConfig(env)

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

    this.app = createApp({
      config: this.config,
      logger: this.logger,
      modelProvider: this.modelProvider,
      traceRecorder: this.traceRecorder
    })
  }
}
