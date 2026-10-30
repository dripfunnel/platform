import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundle } from './bundle'

// A theme's url(<media id>) reaches the browser as the shop's own /shop-api/assets/{id} (storefront AI-STUDIO §8).

const baseline = fileURLToPath(new URL('../../../../templates/storefront/themes/baseline/', import.meta.url))
let repo = ''
let out = ''

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'df-media-'))
  out = mkdtempSync(join(tmpdir(), 'df-media-out-'))
  cpSync(baseline, repo, { recursive: true, filter: (from) => !from.includes('node_modules') })
  mkdirSync(join(repo, 'src/theme/styles'), { recursive: true })
  const home = join(repo, 'src/theme/styles/home.module.css')
  writeFileSync(home, `${readFileSync(home, 'utf8')}\n.picture { background-image: url(m_hero01); }\n`)
})
afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
})

describe('url(<media id>) in a theme', () => {
  it('bundles to the shop asset path instead of failing as a missing file', async () => {
    const built = await bundle(repo, out)
    expect(built.ok, JSON.stringify(built.ok ? null : built.problems)).toBe(true)
    const css = readdirSync(join(out, 'assets'))
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(out, 'assets', f), 'utf8'))
      .join('')
    expect(css).toMatch(/url\(\.\.\/shop-api\/assets\/m_hero01\)|url\("\.\.\/shop-api\/assets\/m_hero01"\)/)
  })

  it('names the shop’s own origin in the live build, whose stylesheet is on the asset origin', async () => {
    const live = mkdtempSync(join(tmpdir(), 'df-media-live-'))
    try {
      const built = await bundle(repo, live, 'https://shop.example.com')
      expect(built.ok).toBe(true)
      const css = readdirSync(join(live, 'assets'))
        .filter((f) => f.endsWith('.css'))
        .map((f) => readFileSync(join(live, 'assets', f), 'utf8'))
        .join('')
      expect(css).toContain('https://shop.example.com/shop-api/assets/m_hero01')
    } finally {
      rmSync(live, { recursive: true, force: true })
    }
  })
})
