import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CliUsageError } from '~/core/cli'
import { parseCliCommand } from '~/infra/cli'

describe('parseCliCommand', () => {
  it('parses the run command', () => {
    const command = parseCliCommand(
      [
        'run',
        '--repo',
        './fixture',
        '--task',
        'Duplicate webhook creates two payments'
      ],
      '/project'
    )

    expect(command).toEqual({
      type: 'run',
      repositoryPath: path.resolve('/project', './fixture'),
      task: 'Duplicate webhook creates two payments'
    })
  })

  it('returns help when no command is provided', () => {
    expect(parseCliCommand([])).toEqual({
      type: 'help'
    })
  })

  it('rejects a missing task', () => {
    expect(() => parseCliCommand(['run', '--repo', './fixture'])).toThrow(
      CliUsageError
    )
  })

  it('rejects an unknown command', () => {
    expect(() => parseCliCommand(['unknown'])).toThrow('Unknown command')
  })
})
