import type { Application, ApplicationDependencies } from '~/app'

import { createApp } from '~/app'

export interface CompositionRoot {
  app: Application
}

export function createCompositionRoot(): CompositionRoot {
  const dependencies: ApplicationDependencies = {}

  const app = createApp(dependencies)

  return {
    app
  }
}
