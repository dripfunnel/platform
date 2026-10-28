import { keepSaved, loadSaved, nothingSaved, type Saved } from './store'

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

const saved: Saved = {
  steps: [{ kind: 'delivered', deliveryId: 'd-1', at: '2026-10-28T10:00:00.000Z', key: 'k-1', code: '2580', cashCollected: true }],
  notices: [{ deliveryId: 'd-0', code: 'CODE_UNCONFIRMED' }],
}

beforeEach(() => mockKeystore.clear())

describe('the steps kept on the phone', () => {
  it('come back as they were kept, per store host', async () => {
    await keepSaved('acme.my-store.one', saved)
    expect(await loadSaved('acme.my-store.one')).toEqual(saved)
    expect(await loadSaved('other.my-store.one')).toEqual(nothingSaved)
  })

  it('leave nothing behind once nothing is kept', async () => {
    await keepSaved('acme.my-store.one', saved)
    await keepSaved('acme.my-store.one', nothingSaved)
    expect(mockKeystore.size).toBe(0)
  })

  it('are nothing when what is stored cannot be read', async () => {
    mockKeystore.set('df.pending.acme.my-store.one', '{"steps":[{"kind":"other"}],"notices":[]}')
    expect(await loadSaved('acme.my-store.one')).toEqual(nothingSaved)
    mockKeystore.set('df.pending.acme.my-store.one', 'not json')
    expect(await loadSaved('acme.my-store.one')).toEqual(nothingSaved)
  })
})
