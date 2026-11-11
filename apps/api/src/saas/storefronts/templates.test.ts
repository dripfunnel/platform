import { describe, expect, it } from 'vitest'
import { lockedWorkflowFile } from '#integrations/github/oidc'
import { fakeSites, putText } from '../../../tests/support/sites'
import { currentCore, skeletonRefresh, templateFiles } from './templates'

describe('skeletonRefresh', () => {
  let sites = fakeSites()
  const skeleton = (core: string, paths: string[]) => putText(sites, `templates/${core}/skeleton.json`, JSON.stringify({ files: [lockedWorkflowFile, 'package.json', ...paths].map((path) => ({ path, content: `${core} ${path}` })) }))

  it('sends the new core’s template files and drops only those the old core had, never a file an upgrade never writes', async () => {
    sites = fakeSites()
    const never = ['store.config.ts', '.env.development', 'src/theme/manifest.ts', '.git/hooks/pre-commit', 'src/app/.git/config', 'node_modules/next/index.js']
    await skeleton('1.0.0', ['AGENTS.md', 'src/app/old.ts', ...never])
    await skeleton('1.1.0', ['AGENTS.md', 'src/app/new.ts', ...never])
    expect(await skeletonRefresh(sites, '1.0.0', '1.1.0')).toEqual([
      { path: 'AGENTS.md', content: '1.1.0 AGENTS.md' },
      { path: 'src/app/new.ts', content: '1.1.0 src/app/new.ts' },
      { path: 'src/app/old.ts', content: null },
    ])
  })

  it('reads one skeleton for the same core, and fails when one is missing', async () => {
    sites = fakeSites()
    await skeleton('1.1.0', ['AGENTS.md'])
    expect(await skeletonRefresh(sites, '1.1.0', '1.1.0')).toEqual([{ path: 'AGENTS.md', content: '1.1.0 AGENTS.md' }])
    await expect(skeletonRefresh(sites, '1.0.0', '1.1.0')).rejects.toThrow('templates/1.0.0/skeleton.json is missing')
  })
})

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
