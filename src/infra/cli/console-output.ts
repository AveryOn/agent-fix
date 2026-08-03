import type { Writable } from 'node:stream'
import type { CliOutput } from '~/core/cli'

export class ConsoleOutput implements CliOutput {
  constructor(
    private readonly stdout: Writable = process.stdout,
    private readonly stderr: Writable = process.stderr
  ) {}

  writeLine(message: string): void {
    this.stdout.write(`${message}\n`)
  }

  writeError(message: string): void {
    this.stderr.write(`${message}\n`)
  }
}
