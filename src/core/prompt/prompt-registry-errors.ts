import type { AgentRole } from '~/core/context'

export enum PromptRegistryErrorCode {
  not_found = 'not_found',
  invalid_version = 'invalid_version',
  invalid_metadata = 'invalid_metadata',
  read_failed = 'read_failed'
}

export interface PromptRegistryErrorOptions {
  readonly agent?: AgentRole
  readonly version?: string
  readonly cause?: unknown
}

export class PromptRegistryError extends Error {
  readonly code: PromptRegistryErrorCode
  readonly agent?: AgentRole
  readonly version?: string

  constructor(
    message: string,
    code: PromptRegistryErrorCode,
    options: PromptRegistryErrorOptions = {}
  ) {
    super(message, {
      cause: options.cause
    })

    this.name = 'PromptRegistryError'
    this.code = code

    if (options.agent !== undefined) {
      this.agent = options.agent
    }

    if (options.version !== undefined) {
      this.version = options.version
    }
  }
}
