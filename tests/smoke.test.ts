import { describe, expect, it } from 'vitest'
import { createCompositionRoot } from '~/composition-root'

describe('application bootstrap', () => {
  it('starts with all dependencies from the composition root', async () => {
    const { app } = createCompositionRoot()

    await expect(app.start()).resolves.toBeUndefined()
    await expect(app.stop()).resolves.toBeUndefined()
  })
})
