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

  // Card #790: the build image's package is private, so the runner logs in to pull it.
  it('logs in to ghcr before the pull and logs out after, with the secret in a step of its own', () => {
    const step = (name: string, next: string) => workflow.slice(workflow.indexOf(`- name: ${name}`), workflow.indexOf(`- name: ${next}`))
    const pullStep = step('pull', 'build')
    const order = ['docker login ghcr.io', 'docker pull ', 'docker logout ghcr.io'].map((text) => pullStep.indexOf(text))
    expect(order[0]).toBeGreaterThan(-1)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    const secrets = workflow.split('\n').filter((line) => line.includes('secrets.'))
    expect(secrets).toHaveLength(1)
    expect(pullStep).toContain(secrets[0]?.trim())
    expect(step('fetch', 'pull')).not.toMatch(/GHCR|secrets\.|docker (login|pull)/)
    expect(workflow.split('\n').filter((line) => line.includes('docker run') && /GHCR|secrets\./.test(line))).toEqual([])
  })

  it('accepts the dev prerelease of core the platform names', () => {
    const pattern = workflow.match(/"\$core" =~ (\S+) &&/)?.[1]
    expect(pattern).toBeDefined()
    const accepts = (version: string) => new RegExp(pattern as string).test(version)
    expect([accepts('1.4.0'), accepts('0.0.0-dev.7'), accepts('latest'), accepts('1.4.0;rm'), accepts('1.0.0-dev.abc'), accepts('1.0.0-rc.1')]).toEqual([true, true, false, false, false, false])
  })
})
