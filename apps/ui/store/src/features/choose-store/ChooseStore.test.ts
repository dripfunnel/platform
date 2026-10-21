import { describe, expect, it } from 'vitest'
import type { StoreChoice } from '../../api/shell'
import { chooserDestination, chooserStep, signInSearch } from './ChooseStore'

const choice = (id: string): StoreChoice => ({ membershipId: `m-${id}`, store: { id, name: id }, role: 'owner', tier: null, seller: null })

describe('the store chooser', () => {
  it('refuses none, opens one, and lists several', () => {
    expect(chooserStep([])).toEqual({ kind: 'none' })
    expect(chooserStep([choice('a')])).toEqual({ kind: 'open', choice: choice('a') })
    expect(chooserStep([choice('a'), choice('b')])).toEqual({ kind: 'pick' })
  })

  it('lands on the page that sent the person, on this host only', () => {
    const origin = 'https://store.northstar.example'
    expect(chooserDestination('/orders?status=open', origin)).toBe('/orders?status=open')
    expect(chooserDestination('//evil.example/home', origin)).toBe('/home')
    expect(chooserDestination('https://evil.example', origin)).toBe('/home')
    expect(chooserDestination(undefined, origin)).toBe('/home')
  })

  it('sends someone signed out to sign-in with the landing they came for, on this host only', () => {
    const origin = 'https://store.northstar.example'
    expect(signInSearch('/orders', origin)).toEqual({ next: '/orders' })
    expect(signInSearch('//evil.example', origin)).toEqual({ next: '/home' })
  })
})
