// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keepShopperToken, shopperToken, storedShopState } from './tokens'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('the shopper’s tokens', () => {
  it('keeps a remembered token in the browser and a visit’s in the visit, the visit’s first', () => {
    keepShopperToken('cart', 'c1')
    expect(localStorage.getItem('df-cart')).toBe('c1')
    keepShopperToken('session', 's1', { remember: false })
    expect(sessionStorage.getItem('df-session')).toBe('s1')
    expect(localStorage.getItem('df-session')).toBeNull()
    localStorage.setItem('df-session', 'older')
    expect(shopperToken('session')).toBe('s1')
    expect(storedShopState()).toEqual({ cartToken: 'c1', sessionToken: 's1' })
  })

  it('forgets a token from both places, and keeps a new one in only one', () => {
    localStorage.setItem('df-session', 'a')
    sessionStorage.setItem('df-session', 'b')
    keepShopperToken('session', null)
    expect(shopperToken('session')).toBeUndefined()
    keepShopperToken('session', 'c')
    expect([localStorage.getItem('df-session'), sessionStorage.getItem('df-session')]).toEqual(['c', null])
  })

  it('has no token, and throws nothing, where storage is off', () => {
    const blocked = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => keepShopperToken('cart', 'c1')).not.toThrow()
    expect(shopperToken('cart')).toBeUndefined()
    expect(storedShopState()).toEqual({ cartToken: undefined, sessionToken: undefined })
  })
})
