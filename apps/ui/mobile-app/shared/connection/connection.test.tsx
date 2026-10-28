import { useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { isOnline, useOnline } from './index'

type NetState = { isConnected: boolean | null; isInternetReachable: boolean | null }
const mockNet: { listener: ((state: NetState) => void) | null } = { listener: null }
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: (state: NetState) => void) => {
      mockNet.listener = listener
      return () => undefined
    },
  },
}))

// The module watches the phone once for the life of the app, so the tests share it and each starts by putting it back online.
const seen: boolean[] = []
function Probe() {
  const online = useOnline()
  useEffect(() => void seen.push(online), [online])
  return null
}
const report = (state: NetState) => act(async () => mockNet.listener?.(state))
const online = { isConnected: true, isInternetReachable: true }
const offline = { isConnected: false, isInternetReachable: false }

beforeAll(async () => {
  await act(async () => void create(<Probe />))
})
beforeEach(async () => {
  await report(online)
  seen.length = 0
})

describe('whether the phone is online', () => {
  it('is online when the phone has not said yet (`null`)', async () => {
    await report({ isConnected: null, isInternetReachable: null })
    expect(isOnline()).toBe(true)
  })

  it('is offline when the phone has no connection, or has one that reaches nothing', async () => {
    await report(offline)
    expect(isOnline()).toBe(false)
    await report(online)
    expect(isOnline()).toBe(true)
    await report({ isConnected: true, isInternetReachable: false })
    expect(isOnline()).toBe(false)
  })

  it('tells a screen watching it, and only when it changes', async () => {
    await report(offline)
    await report(offline)
    await report(online)
    expect(seen).toEqual([false, true])
  })
})
