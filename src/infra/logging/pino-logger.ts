import type { DestinationStream, Logger as PinoLoggerInstance } from 'pino'
import type { LogContext, Logger } from '~/core/logging'

import pino from 'pino'
import { LogLevel } from '~/core/logging'
import { redactSensitiveData } from '~/core/observability'

type WritableLogLevel = Exclude<LogLevel, 'silent'>

export interface PinoLoggerOptions {
  readonly level: LogLevel
  readonly pretty: boolean
  readonly serviceName?: string
  readonly destination?: DestinationStream
}

export function createPinoLogger(options: PinoLoggerOptions): Logger {
  const loggerOptions: pino.LoggerOptions = {
    level: options.level,
    base: {
      service: options.serviceName ?? 'AgentFix'
    }
  }

  if (options.destination !== undefined) {
    return new PinoLoggerAdapter(pino(loggerOptions, options.destination))
  }

  if (options.pretty) {
    const transport = pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname'
      }
    })

    return new PinoLoggerAdapter(pino(loggerOptions, transport))
  }

  return new PinoLoggerAdapter(pino(loggerOptions))
}

class PinoLoggerAdapter implements Logger {
  constructor(private readonly logger: PinoLoggerInstance) {}

  child(context: LogContext): Logger {
    return new PinoLoggerAdapter(
      this.logger.child(toRecord(redactSensitiveData(context)))
    )
  }

  trace(message: string, data?: unknown): void {
    this.write(LogLevel.trace, message, data)
  }

  debug(message: string, data?: unknown): void {
    this.write(LogLevel.debug, message, data)
  }

  info(message: string, data?: unknown): void {
    this.write(LogLevel.info, message, data)
  }

  warn(message: string, data?: unknown): void {
    this.write(LogLevel.warn, message, data)
  }

  error(message: string, data?: unknown): void {
    this.write(LogLevel.error, message, data)
  }

  fatal(message: string, data?: unknown): void {
    this.write(LogLevel.fatal, message, data)
  }

  flush(): void {
    this.logger.flush()
  }

  private write(
    level: WritableLogLevel,
    message: string,
    data?: unknown
  ): void {
    if (data === undefined) {
      this.writeMessage(level, message)
      return
    }

    this.writeData(level, message, toRecord(redactSensitiveData(data)))
  }

  private writeMessage(level: WritableLogLevel, message: string): void {
    switch (level) {
      case LogLevel.trace:
        this.logger.trace(message)
        return
      case LogLevel.debug:
        this.logger.debug(message)
        return
      case LogLevel.info:
        this.logger.info(message)
        return
      case LogLevel.warn:
        this.logger.warn(message)
        return
      case LogLevel.error:
        this.logger.error(message)
        return
      case LogLevel.fatal:
        this.logger.fatal(message)
    }
  }

  private writeData(
    level: WritableLogLevel,
    message: string,
    data: Record<string, unknown>
  ): void {
    switch (level) {
      case LogLevel.trace:
        this.logger.trace(data, message)
        return
      case LogLevel.debug:
        this.logger.debug(data, message)
        return
      case LogLevel.info:
        this.logger.info(data, message)
        return
      case LogLevel.warn:
        this.logger.warn(data, message)
        return
      case LogLevel.error:
        this.logger.error(data, message)
        return
      case LogLevel.fatal:
        this.logger.fatal(data, message)
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>
  }

  return {
    data: value
  }
}
