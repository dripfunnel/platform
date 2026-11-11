import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isRefreshedPath, isRepoPath } from './paths'

// The API's copy (apps/api/src/saas/storefronts/paths.ts) decides what it sends; a path only one of them refuses would
// fail every upgrade as a 400 (storefront ARCHITECTURE §7.1, #1416).
const apiSource = readFileSync(fileURLToPath(new URL('../../api/src/saas/storefronts/paths.ts', import.meta.url)), 'utf8')
const literal = /const notRefreshed = \/(.+)\/([a-z]*)\r?\n/.exec(apiSource)
const apiNotRefreshed = new RegExp(literal?.[1] ?? '^$', literal?.[2])
const apiIsRefreshedPath = (path: string) => isRepoPath(path) && !apiNotRefreshed.test(path)

const refreshed = ['AGENTS.md', 'CLAUDE.md', '.npmrc', 'next.config.ts', 'src/app/layout.tsx', 'src/app/theme-media/route.dev.ts', 'src/app/gitignore.ts', 'tests/.gitkeep', '.gitignore', 'src/themes/x.ts', 'contents/x.json']
const never = [
  'src/theme/pages/HomePage.tsx',
  'SRC/Theme/manifest.ts',
  'content/en/pages.json',
  'Content/en/pages.json',
  'routes.json',
  'Routes.JSON',
  'package.json',
  'store.config.ts',
  '.env.development',
  '.github/workflows/build.yml',
  '.GitHub/workflows/x.yml',
  '.git/hooks/pre-commit',
  '.GIT/config',
  'src/app/.git/hooks/post-commit',
  'node_modules/next/index.js',
  'src/app/Node_Modules/x.js',
  '../outside.ts',
]

describe('the template files an upgrade refreshes', () => {
  it('are the same in the sandbox and in the API’s copy', () => {
    expect(literal).not.toBeNull()
    for (const path of [...refreshed, ...never]) expect(apiIsRefreshedPath(path), path).toBe(isRefreshedPath(path))
  })

  it('never include the theme, the generated files, package.json, .github, .git or node_modules', () => {
    expect(refreshed.filter((p) => !isRefreshedPath(p))).toEqual([])
    expect(never.filter(isRefreshedPath)).toEqual([])
  })
})
