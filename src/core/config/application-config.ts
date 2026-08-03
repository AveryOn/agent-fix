import type { Environment } from '~/env'

export class AppConfig {
  readonly environment: Environment

  constructor(env: Environment) {
    this.environment = env
  }
}
