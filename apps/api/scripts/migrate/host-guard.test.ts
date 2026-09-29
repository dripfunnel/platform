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
})
