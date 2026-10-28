import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { SessionProvider } from './SessionProvider'
import { useSession, type Session } from './SessionContext'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('@dripfunnel/mobile-shared/brand', () => ({ storeHost: () => 'acme.my-store.one' }))

// The phone's keystore, in memory.
const mockKeystore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string) => Promise.resolve(mockKeystore.get(key) ?? null),
  setItemAsync: (key: string, value: string) => {
    mockKeystore.set(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    mockKeystore.delete(key)
    return Promise.resolve()
  },
}))

const tokenKey = 'df.session.acme.my-store.one.token'
let session!: Session
const Probe = () => {
  const current = useSession()
  useEffect(() => {
    session = current
  })
  return null
}

const mount = async () => {
  await act(async () => void create(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  ))
  await act(async () => void (await Promise.resolve()))
}

const answerWith = (answer: () => Promise<unknown>) => {
  global.fetch = jest.fn(answer) as unknown as typeof fetch
}
const ok = (data: unknown) => Promise.resolve({ json: async () => ({ data }) })
const refused = (code: string) => Promise.resolve({ json: async () => ({ errors: [{ message: 'x', extensions: { code } }] }) })

beforeEach(() => mockKeystore.clear())

describe('the rider’s session', () => {
  it('starts signed out with no token, and keeps one in secure storage once signed in', async () => {
    await mount()
    expect(session.signedIn).toBe(false)
    await act(async () => session.startSession('tok-1'))
    expect(session.signedIn).toBe(true)
    expect(mockKeystore.get(tokenKey)).toBe('tok-1')
  })

  it('stays signed in across a restart', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    await mount()
    expect(session.signedIn).toBe(true)
  })

  it('sends the token with every call', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    answerWith(() => ok({ me: null }))
    await mount()
    await act(async () => void (await session.client.request('{ me { id } }')))
    expect((global.fetch as jest.Mock).mock.calls[0]?.[1].headers.authorization).toBe('Bearer tok-1')
  })

  it('clears the token on sign out, and so is signed out', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    answerWith(() => ok({ signOut: true }))
    await mount()
    await act(async () => session.signOut())
    expect(mockKeystore.has(tokenKey)).toBe(false)
    expect(session.signedIn).toBe(false)
  })

  it('clears the token on sign out even when the phone has no signal', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    answerWith(() => Promise.reject(new Error('offline')))
    await mount()
    await act(async () => session.signOut())
    expect(mockKeystore.has(tokenKey)).toBe(false)
    expect(session.signedIn).toBe(false)
  })

  it('keeps the session while the rider carries a parcel', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    answerWith(() => refused('RIDER_HAS_PARCEL'))
    await mount()
    let error: unknown
    await act(async () => {
      error = await session.signOut().catch((e: unknown) => e)
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(mockKeystore.get(tokenKey)).toBe('tok-1')
    expect(session.signedIn).toBe(true)
  })

  it('lets go of the token when any call is answered as signed out', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    answerWith(() => refused('UNAUTHENTICATED'))
    await mount()
    await act(async () => void (await session.client.request('{ deliveries { id } }').catch(() => undefined)))
    expect(mockKeystore.has(tokenKey)).toBe(false)
    expect(session.signedIn).toBe(false)
  })

  it('lets go of the token when the photo upload is answered as signed out', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    global.fetch = jest.fn().mockResolvedValueOnce({ blob: async () => 'IMAGE' }).mockResolvedValueOnce({ json: async () => ({ ok: false, code: 'UNAUTHENTICATED' }) }) as unknown as typeof fetch
    await mount()
    let error: unknown
    await act(async () => {
      error = await session.uploadPhoto('file:///me.jpg', 'image/jpeg').catch((e: unknown) => e)
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(mockKeystore.has(tokenKey)).toBe(false)
    expect(session.signedIn).toBe(false)
  })

  it('treats a profile the API reads as signed out as a session that ended', async () => {
    mockKeystore.set(tokenKey, 'tok-1')
    answerWith(() => ok({ me: null }))
    await mount()
    let error: unknown
    await act(async () => {
      error = await session.fetchRider().catch((e: unknown) => e)
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(mockKeystore.has(tokenKey)).toBe(false)
  })
})
