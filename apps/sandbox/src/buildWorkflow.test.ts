import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Card #786: GitHub rejects the whole workflow if a job's env names a context it doesn't have there.
const workflow = readFileSync(fileURLToPath(new URL('../../../templates/storefront/.github/workflows/build.yml', import.meta.url)), 'utf8')
const allowed = new Set(['github', 'needs', 'strategy', 'matrix', 'vars', 'secrets', 'inputs'])

const jobEnv = (text: string) => {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^ {4}env:\s*$/.test(line))
  const end = lines.findIndex((line, i) => i > start && /^ {0,4}\S/.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

describe('the locked build workflow', () => {
  it("uses only contexts a job's env has", () => {
    const env = jobEnv(workflow)
    expect(env).toContain('BUILD_ID')
    const contexts = [...env.matchAll(/\$\{\{\s*([A-Za-z_]+)/g)].map((match) => match[1] as string)
    expect(contexts.filter((context) => !allowed.has(context))).toEqual([])
  })

  it('sets the folders the later steps read', () => {
    expect(workflow).toMatch(/echo "IN=\$IN"[^\n]*CHECKED=\$CHECKED[^\n]*SITE=\$BUILT\/site[^\n]*\$GITHUB_ENV/)
  })
})
