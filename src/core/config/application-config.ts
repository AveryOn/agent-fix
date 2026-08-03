import type { Environment } from '~/core/config/environment'

export class AppConfig {
  readonly environment: Environment

  constructor(env: Environment) {
    this.environment = env
  }
}
