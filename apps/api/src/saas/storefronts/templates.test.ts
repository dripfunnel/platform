import { describe, expect, it } from 'vitest'
import { fakeSites, putText } from '../../../tests/support/sites'
import { currentCore } from './templates'

describe('currentCore', () => {
  it.each(['1.4.0', '0.0.0-dev.6'])('reads %s', async (core) => {
    const sites = fakeSites()
    await putText(sites, 'templates/current.json', JSON.stringify({ core }))
    expect(await currentCore(sites)).toBe(core)
  })

  it('refuses a version that is not one', async () => {
    const sites = fakeSites()
    await putText(sites, 'templates/current.json', JSON.stringify({ core: 'latest' }))
    await expect(currentCore(sites)).rejects.toThrow('shape')
  })
})
