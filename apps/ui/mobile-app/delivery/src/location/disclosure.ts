import * as SecureStore from 'expo-secure-store'

// Whether this phone has shown the rider how the app uses location, before the first request for it (Google Play's prominent
// disclosure; Apple 5.1.1; docs/mobile-app/delivery/FIRST-RELEASE.md §2). Kept per store's app, in secure storage like the rest.
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
const keyOf = (host: string): string => `df.location.disclosure.${host}`

/** A keystore that fails reads as not shown, so the rider sees it again rather than being asked for location without it. */
export const disclosureAccepted = async (host: string): Promise<boolean> => {
  try {
    return (await SecureStore.getItemAsync(keyOf(host))) === 'accepted'
  } catch {
    return false
  }
}

export const acceptDisclosure = (host: string): Promise<void> => SecureStore.setItemAsync(keyOf(host), 'accepted', options)
