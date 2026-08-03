export interface Cli {
  execute(argv: readonly string[]): Promise<number>
}

export interface CliOutput {
  writeLine(message: string): void
  writeError(message: string): void
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}
