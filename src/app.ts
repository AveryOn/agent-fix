import type { AppConfig } from '~/core/config'
import type { ModelProvider } from '~/core/model'

export interface ApplicationDependencies {
  readonly config: AppConfig
  readonly modelProvider: ModelProvider
}

export interface Application {
  start(): Promise<void>
  stop(): Promise<void>
}

type ApplicationStatus = 'created' | 'started' | 'stopped'

export function createApp(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _dependencies: ApplicationDependencies
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

    async stop(): Promise<void> {
      if (status === 'stopped') {
        return
      }

      status = 'stopped'
    }
  }
}
