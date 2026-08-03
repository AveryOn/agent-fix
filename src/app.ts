import type { AppConfig } from '~/core/config'

export interface ApplicationDependencies {
  config: AppConfig
}

export interface Application {
  start(): Promise<void>
  stop(): Promise<void>
}

type ApplicationStatus = 'created' | 'started' | 'stopped'

export function createApp(
  _dependencies: ApplicationDependencies
): Application {
  let status: ApplicationStatus = 'created'
  void _dependencies

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
