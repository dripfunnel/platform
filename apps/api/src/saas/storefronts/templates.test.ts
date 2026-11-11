import { describe, expect, it } from 'vitest'
import { lockedWorkflowFile } from '#integrations/github/oidc'
import { fakeSites, putText } from '../../../tests/support/sites'
import { currentCore, templateFiles } from './templates'

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

describe('templateFiles', () => {
  it('takes a skeleton holding a Next.js dynamic route (#1420)', async () => {
    const sites = fakeSites()
    const skeleton = [lockedWorkflowFile, 'package.json', 'src/app/theme-media/[name]/route.dev.ts'].map((path) => ({ path, content: '' }))
    await putText(sites, 'templates/1.4.0/skeleton.json', JSON.stringify({ files: skeleton }))
    await putText(sites, 'templates/1.4.0/themes/baseline/source.json', JSON.stringify({ files: [{ path: 'routes.json', content: '{}' }] }))
    expect((await templateFiles(sites, '1.4.0', 'baseline')).skeleton.map((f) => f.path)).toContain('src/app/theme-media/[name]/route.dev.ts')
  })
})
