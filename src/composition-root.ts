import type { Application, ApplicationDependencies } from '~/app'

import { createApp } from '~/app'
import { AppConfig } from '~/core/config'
import { env } from '~/env'

export class CompositionRoot {
  readonly app: Application
  readonly dependencies: ApplicationDependencies

  constructor() {
    this.dependencies = {
      config: new AppConfig(env)
    }
    this.app = createApp(this.dependencies)
  }
}
