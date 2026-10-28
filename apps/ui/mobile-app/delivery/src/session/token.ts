import { secureStorage } from '@dripfunnel/mobile-shared/storage'

// The rider's session token, in the phone's secure storage and never anywhere else, keyed by the store's host (docs/mobile-app/delivery/ARCHITECTURE.md §2).
const storage = (host: string) => secureStorage<null>(host, () => null)

/** A keystore that fails reads as no token, so the rider signs in again. */
export const loadToken = async (host: string): Promise<string | null> => (await storage(host).read()).token

export const saveToken = (host: string, token: string): Promise<void> => storage(host).writeToken(token)

/** Sign-out and an ended session: the token goes from secure storage (and is marked revoked if the keystore would not let go, so it is not used). */
export const clearToken = (host: string): Promise<void> => storage(host).wipe()
