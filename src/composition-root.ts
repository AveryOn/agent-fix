import { createApp } from '~/app'

export interface CompositionRoot {
  app: ReturnType<typeof createApp>
}

export function createCompositionRoot(): CompositionRoot {
  const app = createApp()

  return {
    app
  }
}
