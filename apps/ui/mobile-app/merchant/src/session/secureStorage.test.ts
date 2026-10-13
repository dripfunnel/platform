import { within } from './secureStorage'

describe('a storage that may fail', () => {
  it('gives the answer when the keystore answers', async () => {
    await expect(within(Promise.resolve('t0ken'), null)).resolves.toBe('t0ken')
  })

  it('gives the fallback, not an error, when the keystore fails', async () => {
    await expect(within(Promise.reject(new Error('KeyStoreException')), null)).resolves.toBeNull()
  })

  it('gives the fallback when the keystore never answers', async () => {
    jest.useFakeTimers()
    try {
      const result = within(new Promise<string | null>(() => undefined), null, 1000)
      await jest.advanceTimersByTimeAsync(1000)
      await expect(result).resolves.toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})
