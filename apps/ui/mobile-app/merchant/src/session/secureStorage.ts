import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'
import type { Acting, SessionStorage } from './sessionStore'

const actingSchema = z.object({ storeId: z.string(), supplierId: z.string().nullable(), storeName: z.string() })

// Keyed by the portal host, so a build never reads another partner's session. The token never leaves this file's
// calls, and is not logged or shown.
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }

const parseLast = (saved: string | null): Acting | null => {
  try {
    const parsed = actingSchema.safeParse(saved === null ? null : JSON.parse(saved))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const storageTimeoutMs = 5_000

// A keystore that fails or never answers must not leave the app on a blank screen: nothing readable means no saved
// session (the person signs in), and a failed save means the session lasts until the app closes.
export const within = async <T>(work: Promise<T>, fallback: T, timeoutMs = storageTimeoutMs): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const gaveUp = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs)
  })
  try {
    return await Promise.race([work.catch(() => fallback), gaveUp])
  } finally {
    clearTimeout(timer)
  }
}

export const secureStorage = (domain: string): SessionStorage => {
  const tokenKey = `df.session.${domain}.token`
  const lastKey = `df.session.${domain}.last`
  return {
    async read() {
      const token = await within(SecureStore.getItemAsync(tokenKey, options), null)
      return { token, last: token ? parseLast(await within(SecureStore.getItemAsync(lastKey, options), null)) : null }
    },
    writeToken: (token) => within(SecureStore.setItemAsync(tokenKey, token, options), undefined),
    writeLast: (last) => within(SecureStore.setItemAsync(lastKey, JSON.stringify(last), options), undefined),
    async wipe() {
      await within(SecureStore.deleteItemAsync(tokenKey, options), undefined)
      await within(SecureStore.deleteItemAsync(lastKey, options), undefined)
    },
  }
}
