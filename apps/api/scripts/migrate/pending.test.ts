import { describe, expect, it } from 'vitest'
import { pendingMigrations } from './pending'

describe('pendingMigrations', () => {
  it('sorts sql files and drops already-applied ones', () => {
    const files = ['0002_add_index.sql', '0001_init.sql', 'README.md']
    expect(pendingMigrations(files, new Set())).toEqual(['0001_init.sql', '0002_add_index.sql'])
    expect(pendingMigrations(files, new Set(['0001_init.sql']))).toEqual(['0002_add_index.sql'])
  })
})
