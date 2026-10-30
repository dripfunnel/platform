import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin'
import Constants from 'expo-constants'
import { z } from 'zod'

// Google's native sign-in on the partner's own clients (#1048; mobile-app/merchant CONFIGURATION.md §2). The ID token is
// issued for the web client, which is what the API checks it against.

const extra = z.object({ google: z.object({ webClientId: z.string().min(1), iosClientId: z.string().min(1) }).optional() })

export type GoogleClients = { webClientId: string; iosClientId: string }

/** The build's Google clients, or null for a partner whose build has none. */
export const googleClients = (): GoogleClients | null => {
  const parsed = extra.safeParse(Constants.expoConfig?.extra)
  return parsed.success ? (parsed.data.google ?? null) : null
}

/** The person closed Google's sheet: nothing to say beyond that. */
export class GoogleCancelled extends Error {}
/** Google couldn't be reached or gave no token (no Play services, no network). */
export class GoogleUnavailable extends Error {}

export const googleIdToken = async (clients: GoogleClients): Promise<string> => {
  GoogleSignin.configure({ webClientId: clients.webClientId, iosClientId: clients.iosClientId })
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    const response = await GoogleSignin.signIn()
    if (!isSuccessResponse(response)) throw new GoogleCancelled()
    if (!response.data.idToken) throw new GoogleUnavailable()
    return response.data.idToken
  } catch (failed) {
    if (failed instanceof GoogleCancelled || failed instanceof GoogleUnavailable) throw failed
    if (isErrorWithCode(failed) && failed.code === statusCodes.SIGN_IN_CANCELLED) throw new GoogleCancelled()
    throw new GoogleUnavailable()
  } finally {
    // Google's own session isn't kept: the next sign-in asks which account again, as the portal's does.
    await GoogleSignin.signOut().catch(() => undefined)
  }
}
