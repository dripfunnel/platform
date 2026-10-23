import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

/** Where a session's token and the app's "last used" choice live: the phone's secure storage. */
export type SessionStorage<Last> = {
  read: () => Promise<{ token: string | null; last: Last | null }>
  writeToken: (token: string) => Promise<void>
  writeLast: (last: Last) => Promise<void>
  wipe: () => Promise<void>
}

// The token never leaves this file's calls, and is not logged or shown.
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }

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

/** True when the work finished, false when it failed or did not answer in time. */
const done = (work: Promise<unknown>): Promise<boolean> => within(work.then(() => true), false)

// Keyed by the API host, so a build never reads another host's session. `parseLast` reads what `writeLast` saved, or null.
export const secureStorage = <Last>(domain: string, parseLast: (saved: string | null) => Last | null): SessionStorage<Last> => {
  const tokenKey = `df.session.${domain}.token`
  const lastKey = `df.session.${domain}.last`
  // Not a secret, and kept apart from the keystore that failed: set when a sign-out could not remove the token.
  const revokedKey = `df.session.${domain}.revoked`

  const removeToken = () => done(SecureStore.deleteItemAsync(tokenKey, options))
  const setRevoked = (revoked: boolean) => within(revoked ? AsyncStorage.setItem(revokedKey, '1') : AsyncStorage.removeItem(revokedKey), undefined)

  return {
    async read() {
      // A sign-out that could not remove the token stays a sign-out: the token is not used, and its removal is tried again.
      if ((await within(AsyncStorage.getItem(revokedKey), null)) !== null) {
        if (await removeToken()) await setRevoked(false)
        return { token: null, last: null }
      }
      const token = await within(SecureStore.getItemAsync(tokenKey, options), null)
      return { token, last: token ? parseLast(await within(SecureStore.getItemAsync(lastKey, options), null)) : null }
    },
    async writeToken(token) {
      // A new token replaces any token a failed sign-out left behind, so the sign-out mark is no longer needed.
      if (await done(SecureStore.setItemAsync(tokenKey, token, options))) await setRevoked(false)
    },
    writeLast: (last) => within(SecureStore.setItemAsync(lastKey, JSON.stringify(last), options), undefined),
    async wipe() {
      const removed = (await removeToken()) || (await removeToken())
      await within(SecureStore.deleteItemAsync(lastKey, options), undefined)
      if (!removed) await setRevoked(true)
    },
  }
}
