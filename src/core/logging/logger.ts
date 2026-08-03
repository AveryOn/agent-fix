export enum LogLevel {
  fatal = 'fatal',
  error = 'error',
  warn = 'warn',
  info = 'info',
  debug = 'debug',
  trace = 'trace',
  silent = 'silent'
}

export interface LogContext {
  readonly runId?: string
  readonly step?: string
  readonly agent?: string
  readonly attempt?: number
  readonly workspaceRevision?: string
}

export interface Logger {
  child(context: LogContext): Logger

  trace(message: string, data?: unknown): void
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
  fatal(message: string, data?: unknown): void

  flush(): void
}
