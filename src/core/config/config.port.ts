import type { Environment } from '~/env'

export const CONFIG_PORT = Symbol('CONFIG_PORT')

export abstract class ConfigPort {
  abstract env: Environment
}
