import { describe, expect, it } from 'vitest'
import { CompositionRoot } from '~/composition-root'

describe('application bootstrap', () => {
  it('starts with all dependencies from the composition root', async () => {
    const { app } = new CompositionRoot()

    await expect(app.start()).resolves.toBeUndefined()

    await expect(app.execute(['--help'])).resolves.toBe(0)

    await expect(app.stop()).resolves.toBeUndefined()
  })
})
