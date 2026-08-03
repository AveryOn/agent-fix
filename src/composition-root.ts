import type { Application } from '~/app'
import type { ModelProvider } from '~/core/model'

import { createApp } from '~/app'
import { AppConfig } from '~/core/config'
import { env } from '~/env'
import { OpenAiModelProvider } from '~/infra/openai'

export class CompositionRoot {
  readonly app: Application
  readonly config: AppConfig
  readonly modelProvider: ModelProvider

  constructor() {
    this.config = new AppConfig(env)
    this.modelProvider = new OpenAiModelProvider({
      apiKey: this.config.environment.OPENAI_API_KEY,
      model: this.config.environment.OPENAI_MODEL,
      timeoutMs: this.config.environment.OPENAI_TIMEOUT_MS
    })

    this.app = createApp({
      config: this.config,
      modelProvider: this.modelProvider
    })
  }
}
