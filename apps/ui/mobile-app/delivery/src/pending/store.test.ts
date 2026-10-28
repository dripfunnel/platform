import { keepLastRider, keepSaved, loadLastRider, loadSaved, nothingSaved, type Saved } from './store'

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

const host = 'acme.my-store.one'
const saved: Saved = {
  steps: [{ kind: 'delivered', deliveryId: 'd-1', at: '2026-10-28T10:00:00.000Z', key: 'k-1', code: '2580', cashCollected: true }],
  notices: [{ deliveryId: 'd-0', code: 'CODE_UNCONFIRMED', dismissed: false }],
}

beforeEach(() => mockKeystore.clear())

describe('the steps kept on the phone', () => {
  it('come back as they were kept, for that rider only', async () => {
    await keepSaved(host, 'r-1', saved)
    expect(await loadSaved(host, 'r-1')).toEqual(saved)
    expect(await loadSaved(host, 'r-2')).toEqual(nothingSaved)
    expect(await loadSaved('other.my-store.one', 'r-1')).toEqual(nothingSaved)
  })

  it('leave nothing behind once nothing is kept', async () => {
    await keepSaved(host, 'r-1', saved)
    await keepSaved(host, 'r-1', nothingSaved)
    expect(mockKeystore.size).toBe(0)
  })

  it('are nothing when what is stored cannot be read', async () => {
    mockKeystore.set(`df.pending.${host}.rider.r-1`, '{"steps":[{"kind":"other"}],"notices":[]}')
    expect(await loadSaved(host, 'r-1')).toEqual(nothingSaved)
    mockKeystore.set(`df.pending.${host}.rider.r-1`, 'not json')
    expect(await loadSaved(host, 'r-1')).toEqual(nothingSaved)
  })

  it('remember which rider was last signed in, for a phone with no signal', async () => {
    expect(await loadLastRider(host)).toBeNull()
    await keepLastRider(host, 'r-1')
    expect(await loadLastRider(host)).toBe('r-1')
  })
})
