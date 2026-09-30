import { describe, expect, it } from 'vitest'
import { assertLocalHost } from './host-guard'

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

  it('allows a remote host when ALLOW_REMOTE_MIGRATIONS=1 and CI=true', () => {
    const originalAllow = process.env.ALLOW_REMOTE_MIGRATIONS
    const originalCi = process.env.CI
    process.env.ALLOW_REMOTE_MIGRATIONS = '1'
    process.env.CI = 'true'
    try {
      expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).not.toThrow()
    } finally {
      if (originalAllow === undefined) delete process.env.ALLOW_REMOTE_MIGRATIONS
      else process.env.ALLOW_REMOTE_MIGRATIONS = originalAllow
      if (originalCi === undefined) delete process.env.CI
      else process.env.CI = originalCi
    }
  })

  it('still refuses a remote host when ALLOW_REMOTE_MIGRATIONS is unset or not "1"', () => {
    const originalAllow = process.env.ALLOW_REMOTE_MIGRATIONS
    const originalCi = process.env.CI
    process.env.CI = 'true'
    delete process.env.ALLOW_REMOTE_MIGRATIONS
    try {
      expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow()
      process.env.ALLOW_REMOTE_MIGRATIONS = 'true'
      expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow()
    } finally {
      if (originalAllow === undefined) delete process.env.ALLOW_REMOTE_MIGRATIONS
      else process.env.ALLOW_REMOTE_MIGRATIONS = originalAllow
      if (originalCi === undefined) delete process.env.CI
      else process.env.CI = originalCi
    }
  })

  it('still refuses a remote host when ALLOW_REMOTE_MIGRATIONS=1 but CI is not "true"', () => {
    const originalAllow = process.env.ALLOW_REMOTE_MIGRATIONS
    const originalCi = process.env.CI
    process.env.ALLOW_REMOTE_MIGRATIONS = '1'
    delete process.env.CI
    try {
      expect(() => assertLocalHost('postgres://u:p@dbpg01.softobotics.org:5432/db')).toThrow()
    } finally {
      if (originalAllow === undefined) delete process.env.ALLOW_REMOTE_MIGRATIONS
      else process.env.ALLOW_REMOTE_MIGRATIONS = originalAllow
      if (originalCi === undefined) delete process.env.CI
      else process.env.CI = originalCi
    }
  })
})
