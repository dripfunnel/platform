import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { typecheck } from './typecheck'

// The AI designer's worked carousel (apps/api/src/saas/ai-designer/model.ts, #1083) is held to the typecheck here; the API's
// own test holds it to the validator. Read as text, because the sandbox imports nothing from the API.
vi.setConfig({ testTimeout: 120_000 })

const baseline = fileURLToPath(new URL('../../../../templates/storefront/themes/baseline/', import.meta.url))
const source = readFileSync(fileURLToPath(new URL('../../../api/src/saas/ai-designer/model.ts', import.meta.url)), 'utf8')

const walk = (dir: string, rel = ''): string[] => readdirSync(join(dir, rel)).flatMap((n) => (statSync(join(dir, rel, n)).isDirectory() ? walk(dir, `${rel}${n}/`) : [`${rel}${n}`]))

const example = (): Map<string, string> => {
  const body = /export const carouselExample = `([\s\S]*?)`\n/.exec(source)?.[1] ?? ''
  const parts = body.split(/^--- (\S+).*$/m)
  const files = new Map<string, string>()
  for (let i = 1; i < parts.length; i += 2) files.set(parts[i] ?? '', `${(parts[i + 1] ?? '').trim()}\n`)
  return files
}

describe('the AI designer’s worked carousel', () => {
  it('typechecks beside the baseline theme, placed from the home page', () => {
    const theme = new Map(walk(baseline).filter((p) => p !== 'template.json').map((p) => [p, readFileSync(join(baseline, p), 'utf8')]))
    const files = example()
    expect([...files.keys()]).toContain('src/theme/components/interactive/HeroCarousel.tsx')
    for (const [path, content] of files) if (!path.includes('{language}')) theme.set(path, content)
    const home = theme.get('src/theme/pages/HomePage.tsx') ?? ''
    theme.set('src/theme/pages/HomePage.tsx', `import { HeroCarousel } from '../components/interactive/HeroCarousel'\n${home.replace('<Layout>', '<Layout>\n      <HeroCarousel />')}`)
    expect(typecheck(theme)).toEqual([])
  })
})
