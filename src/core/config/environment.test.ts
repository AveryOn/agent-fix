import { describe, expect, it } from 'vitest'
import {
  EnvironmentValidationError,
  parseEnvironment
} from '~/core/config/environment'

describe('parseEnvironment', () => {
  it('parses and transforms valid environment variables', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'test-model',
      RUNS_ROOT: '.runs-test',
      MAX_AGENT_ATTEMPTS: '2',
      OPENAI_TIMEOUT_MS: '60000',
      COMMAND_TIMEOUT_MS: '5000',
      CONTEXT_TOKEN_BUDGET: '4000',
      LOG_LEVEL: 'silent',
      LOG_PRETTY: 'false',
      DOCKER_ENABLED: 'true',
      DOCKER_IMAGE: 'agent-fix-test:local',
      DOCKER_MEMORY_MB: '768',
      DOCKER_CPUS: '1.5',
      DOCKER_PIDS_LIMIT: '128'
    })

    expect(environment).toEqual({
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'test-model',
      RUNS_ROOT: '.runs-test',
      MAX_AGENT_ATTEMPTS: 2,
      OPENAI_TIMEOUT_MS: 60_000,
      COMMAND_TIMEOUT_MS: 5000,
      CONTEXT_TOKEN_BUDGET: 4000,
      LOG_LEVEL: 'silent',
      LOG_PRETTY: false,
      DOCKER_ENABLED: true,
      DOCKER_IMAGE: 'agent-fix-test:local',
      DOCKER_MEMORY_MB: '768',
      DOCKER_CPUS: '1.5',
      DOCKER_PIDS_LIMIT: '128'
    })
  })

  it('applies defaults', () => {
    const environment = parseEnvironment({
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'test-model'
    })

    expect(environment.OPENAI_TIMEOUT_MS).toBe(60_000)
    expect(environment.RUNS_ROOT).toBe('.runs')
    expect(environment.MAX_AGENT_ATTEMPTS).toBe(3)
    expect(environment.COMMAND_TIMEOUT_MS).toBe(120_000)
    expect(environment.CONTEXT_TOKEN_BUDGET).toBe(16_000)
    expect(environment.LOG_LEVEL).toBe('info')
    expect(environment.LOG_PRETTY).toBe(false)
    expect(environment.DOCKER_ENABLED).toBe(false)
    expect(environment.DOCKER_IMAGE).toBe('agent-fix-sandbox:local')
    expect(environment.DOCKER_MEMORY_MB).toBe(512)
    expect(environment.DOCKER_CPUS).toBe(1)
    expect(environment.DOCKER_PIDS_LIMIT).toBe(256)
  })

  it('rejects invalid environment variables', () => {
    expect(() =>
      parseEnvironment({
        NODE_ENV: 'test',
        OPENAI_API_KEY: '',
        OPENAI_MODEL: '',
        MAX_AGENT_ATTEMPTS: '0',
        LOG_PRETTY: 'yes'
      })
    ).toThrow(EnvironmentValidationError)
  })
})
