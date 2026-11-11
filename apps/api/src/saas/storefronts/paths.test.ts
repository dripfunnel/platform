import { describe, expect, it } from 'vitest'
import { isRepoPath } from './paths'

describe('isRepoPath', () => {
  it.each(['package.json', 'src/app/theme-media/[name]/route.dev.ts', 'src/app/[...slug]/page.tsx', 'src/app/[[...slug]]/page.tsx'])('accepts %s', (path) => {
    expect(isRepoPath(path)).toBe(true)
  })

  it.each(['..', 'a/../b', '.', 'a/./b', '', 'a//b', '/abs', 'a/[..]/b', 'a/[]/b', 'a/[...]/b', 'a/[name/b', 'a/name]/b', 'a/[[name]]/b', 'a/[[...slug]/b'])('refuses %j', (path) => {
    expect(isRepoPath(path)).toBe(false)
  })
})
