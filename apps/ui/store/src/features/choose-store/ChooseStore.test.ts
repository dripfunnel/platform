import { describe, expect, it } from 'vitest'
import type { StoreChoice } from '../../api/shell'
import { chooserStep, safeNext } from './ChooseStore'

const choice = (id: string): StoreChoice => ({ membershipId: `m-${id}`, store: { id, name: id }, role: 'owner', tier: null, seller: null })

describe('the store chooser', () => {
  it('refuses none, opens one, and lists several', () => {
    expect(chooserStep([])).toEqual({ kind: 'none' })
    expect(chooserStep([choice('a')])).toEqual({ kind: 'open', choice: choice('a') })
    expect(chooserStep([choice('a'), choice('b')])).toEqual({ kind: 'pick' })
  })

  it('goes back only to a path on this host', () => {
    expect(safeNext('/orders?status=open')).toBe('/orders?status=open')
    expect(safeNext('//evil.example/home')).toBe('/home')
    expect(safeNext('https://evil.example')).toBe('/home')
    expect(safeNext(undefined)).toBe('/home')
  })
})
