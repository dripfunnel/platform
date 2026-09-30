import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertLocalHost } from './host-guard'

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
