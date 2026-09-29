import { describe, expect, it } from 'vitest'
import { assertPostgresMajor, REQUIRED_POSTGRES_MAJOR } from './version-check'

describe('assertPostgresMajor', () => {
  it('allows the required major', () => {
    expect(() => assertPostgresMajor(REQUIRED_POSTGRES_MAJOR * 10000 + 11)).not.toThrow()
  })

  it('refuses any other major, naming both versions', () => {
    expect(() => assertPostgresMajor(160015)).toThrow(/requires Postgres 17\.x.*reports 16\.x/s)
  })
})
