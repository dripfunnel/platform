import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertLocalHost, assertLoopbackOnly } from './host-guard'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('assertLocalHost', () => {
  it('allows localhost and loopback addresses', () => {
    expect(() => assertLocalHost('postgres://u:p@localhost:5432/db')).not.toThrow()
    expect(() => assertLocalHost('postgres://u:p@127.0.0.1:5432/db')).not.toThrow()
    expect(() => assertLocalHost('postgres://u:p@[::1]:5432/db')).not.toThrow()
  })

  it('refuses a remote host', () => {
    expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow(/dbpg01\.softobotics\.org/)
  })

  it('refuses a host override via query params', () => {
    expect(() => assertLocalHost('postgres://u:p@localhost/db?host=dbpg01.softobotics.org')).toThrow(/"host"/)
    expect(() => assertLocalHost('postgres://u:p@localhost/db?hostaddr=10.0.0.1')).toThrow(/"hostaddr"/)
  })

  it('refuses a comma-separated multi-host connection string', () => {
    expect(() => assertLocalHost('postgres://u:p@localhost:5432,dbpg01.softobotics.org:5432/db')).toThrow()
  })

  it('refuses a malformed connection string without leaking it', () => {
    const secret = 'postgres://u:pa/ss@localhost:5432/db'
    try {
      assertLocalHost(secret)
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toBe('DATABASE_URL is not a valid URL.')
      expect((error as Error).message).not.toContain(secret)
    }
  })

  it('allows exactly the ALLOWED_MIGRATION_HOST when ALLOW_REMOTE_MIGRATIONS=1 and CI=true', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', 'ep-cool-branch-123.us-east-2.aws.neon.tech')
    expect(() => assertLocalHost('postgres://u:p@ep-cool-branch-123.us-east-2.aws.neon.tech:5432/db')).not.toThrow()
  })

  it('still refuses a different Neon host (e.g. prod) even when ALLOW_REMOTE_MIGRATIONS=1 and CI=true', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', 'ep-cool-branch-123.us-east-2.aws.neon.tech')
    expect(() =>
      assertLocalHost('postgres://u:p@ep-other-project-999.us-east-2.aws.neon.tech:5432/db'),
    ).toThrow(/ep-other-project-999/)
  })

  it('tolerates uppercase and surrounding whitespace in ALLOWED_MIGRATION_HOST', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', '  EP-Cool-Branch-123.us-east-2.aws.neon.tech  ')
    expect(() => assertLocalHost('postgres://u:p@ep-cool-branch-123.us-east-2.aws.neon.tech:5432/db')).not.toThrow()
  })

  it('says the requested host did not match when the bypass is requested but the host differs', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', 'ep-cool-branch-123.us-east-2.aws.neon.tech')
    expect(() =>
      assertLocalHost('postgres://u:p@ep-other-project-999.us-east-2.aws.neon.tech:5432/db'),
    ).toThrow(/does not match ALLOWED_MIGRATION_HOST/)
  })

  it('still refuses any remote host when ALLOWED_MIGRATION_HOST is unset', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', undefined)
    expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow(/dbpg01\.softobotics\.org/)
  })

  it('still refuses a remote host when ALLOW_REMOTE_MIGRATIONS is unset or not "1"', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', undefined)
    expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow()

    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', 'true')
    expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow()
  })

  it('still refuses a remote host when ALLOW_REMOTE_MIGRATIONS=1 but CI is not "true"', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', undefined)
    expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow()
  })

  it('still allows localhost when the opt-in names a remote host, so a CI step can set it for every test', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', 'ep-cool-branch-123.us-east-2.aws.neon.tech')
    expect(() => assertLocalHost('postgres://u:p@localhost:5432/db')).not.toThrow()
    expect(() => assertLocalHost('postgres://u:p@127.0.0.1:5432/db')).not.toThrow()
  })

  it('still refuses a host override via query params when ALLOW_REMOTE_MIGRATIONS=1 and CI=true', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', 'ep-cool-branch-123.us-east-2.aws.neon.tech')
    expect(() =>
      assertLocalHost('postgres://u:p@ep-cool-branch-123.us-east-2.aws.neon.tech/db?host=dbpg01.softobotics.org'),
    ).toThrow(/"host"/)
    expect(() =>
      assertLocalHost('postgres://u:p@ep-cool-branch-123.us-east-2.aws.neon.tech/db?hostaddr=10.0.0.1'),
    ).toThrow(/"hostaddr"/)
  })
})

describe('assertLoopbackOnly', () => {
  it('allows localhost and both loopback addresses', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(() => assertLoopbackOnly(`postgres://u:p@${host}:5434/db`)).not.toThrow()
  })

  it('refuses a remote host, with no CI opt-in', () => {
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', 'dbpg01.softobotics.org')
    expect(() => assertLoopbackOnly('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow(/Local databases only/)
  })

  it('refuses a host override via query params', () => {
    expect(() => assertLoopbackOnly('postgres://u:p@localhost:5434/db?host=dbpg01.softobotics.org')).toThrow(/Local databases only/)
    expect(() => assertLoopbackOnly('postgres://u:p@localhost:5434/db?hostaddr=10.0.0.9')).toThrow(/Local databases only/)
  })

  it('refuses a malformed connection string without leaking it', () => {
    expect(() => assertLoopbackOnly('not a url with a secret')).toThrow(/not a valid URL/)
    expect(() => assertLoopbackOnly('not a url with a secret')).not.toThrow(/secret/)
  })
})

// #73: a feature environment's database is a Neon branch created by the same run, so the opt-in
// names that host and nothing else; the property worth keeping is that no other host passes.
describe('a feature environment', () => {
  const created = 'ep-quiet-feature-a1b2c3.us-east-2.aws.neon.tech'
  const optIn = () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', created)
  }

  it('migrates the branch the run created', () => {
    optIn()
    expect(() => assertLocalHost(`postgres://u:p@${created}/neondb?sslmode=require`)).not.toThrow()
  })

  it('refuses every host the run did not create: production, another branch, a look-alike', () => {
    optIn()
    for (const other of ['ep-prod-x9y8z7.us-east-2.aws.neon.tech', 'ep-quiet-feature-zzzzzz.us-east-2.aws.neon.tech', `evil.${created}`, `${created}.evil.example`, 'neon.tech']) {
      expect(() => assertLocalHost(`postgres://u:p@${other}/neondb`), other).toThrow(/does not match ALLOWED_MIGRATION_HOST/)
    }
  })

  it('refuses everything when the step that names the host gave nothing', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOW_REMOTE_MIGRATIONS', '1')
    vi.stubEnv('ALLOWED_MIGRATION_HOST', '')
    expect(() => assertLocalHost(`postgres://u:p@${created}/neondb`)).toThrow(/ALLOWED_MIGRATION_HOST is not set/)
  })

  it('is wired that way in the workflow: the opt-in host and the URL come from the same Neon step', () => {
    const workflow = readFileSync(new URL('../../../../.github/workflows/feature-env.yml', import.meta.url), 'utf8')
    const step = workflow.slice(workflow.indexOf('- name: Migrations'), workflow.indexOf('- name:', workflow.indexOf('- name: Migrations') + 1))
    expect(step).toContain('DATABASE_URL: ${{ steps.neon.outputs.db_url }}')
    expect(step).toContain('ALLOWED_MIGRATION_HOST: ${{ steps.neon.outputs.host }}')
    expect(step).toContain("ALLOW_REMOTE_MIGRATIONS: '1'")
    // Never a variable, a suffix or a wildcard: those could name a host this run didn't create.
    expect(workflow.match(/ALLOWED_MIGRATION_HOST:.*/g)).toEqual(['ALLOWED_MIGRATION_HOST: ${{ steps.neon.outputs.host }}'])
  })
})
