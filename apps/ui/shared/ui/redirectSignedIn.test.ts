import { isRedirect } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { previewsState, redirectSignedIn } from './redirectSignedIn'

const origin = 'https://store.northstar.example'
const person = async () => ({ id: 'u1' })
const nobody = async () => null

const landing = async (run: Promise<void>): Promise<string | null> => {
  try {
    await run
    return null
  } catch (thrown) {
    if (!isRedirect(thrown)) throw thrown
    return thrown.options.href ?? null
  }
}

describe('redirectSignedIn', () => {
  it('sends a signed-in person to a next on this app, with its query', async () => {
    expect(await landing(redirectSignedIn({ loadMe: person, next: '/orders?status=open', home: '/home', origin }))).toBe('/orders?status=open')
  })

  it.each([undefined, 'https://evil.example/home', '//evil.example'])('sends a signed-in person home for the next %s', async (next) => {
    expect(await landing(redirectSignedIn({ loadMe: person, next, home: '/home', origin }))).toBe('/home')
  })

  it('leaves the page alone when nobody is signed in, or the read fails', async () => {
    expect(await landing(redirectSignedIn({ loadMe: nobody, next: '/orders', home: '/home', origin }))).toBeNull()
    expect(await landing(redirectSignedIn({ loadMe: () => Promise.reject(new Error('offline')), next: '/orders', home: '/home', origin }))).toBeNull()
  })

  it('never reads the session for a preview state', async () => {
    let read = false
    const loadMe = async () => ((read = true), { id: 'u1' })
    expect(await landing(redirectSignedIn({ loadMe, next: undefined, home: '/home', skip: true, origin }))).toBeNull()
    expect(read).toBe(false)
  })
})

describe('previewsState', () => {
  it('is a preview only with the harness on and a state asked for', () => {
    expect(previewsState(true, '?state=expired')).toBe(true)
    expect(previewsState(true, '?next=/orders')).toBe(false)
    expect(previewsState(false, '?state=expired')).toBe(false)
  })
})
