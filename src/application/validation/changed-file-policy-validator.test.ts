import { describe, expect, it } from 'vitest'
import { ChangedFilePolicyValidator } from '~/application/validation'

describe('ChangedFilePolicyValidator', () => {
  it('accepts files inside the allowed scope', () => {
    const validator = new ChangedFilePolicyValidator()

    expect(
      validator.getViolations(
        ['src/payment-service.ts', 'tests/payment.test.ts'],
        {
          allowedFiles: [
            'src/payment-service.ts',
            'tests/payment.test.ts'
          ],
          forbiddenFiles: [],
          forbiddenPrefixes: ['.github', 'scripts']
        }
      )
    ).toEqual([])
  })

  it('rejects files outside the allowed scope', () => {
    const validator = new ChangedFilePolicyValidator()

    expect(
      validator.getViolations(
        ['src/payment-service.ts', 'src/unrelated.ts'],
        {
          allowedFiles: ['src/payment-service.ts'],
          forbiddenFiles: [],
          forbiddenPrefixes: []
        }
      )
    ).toEqual(['src/unrelated.ts'])
  })

  it('rejects explicitly forbidden files', () => {
    const validator = new ChangedFilePolicyValidator()

    expect(
      validator.getViolations(['package.json'], {
        allowedFiles: ['package.json'],
        forbiddenFiles: ['package.json'],
        forbiddenPrefixes: []
      })
    ).toEqual(['package.json'])
  })

  it('rejects forbidden path prefixes', () => {
    const validator = new ChangedFilePolicyValidator()

    expect(
      validator.getViolations(
        ['.github/workflows/ci.yml', 'scripts/release.sh'],
        {
          allowedFiles: ['.github/workflows/ci.yml', 'scripts/release.sh'],
          forbiddenFiles: [],
          forbiddenPrefixes: ['.github', 'scripts/']
        }
      )
    ).toEqual(['.github/workflows/ci.yml', 'scripts/release.sh'])
  })
})
