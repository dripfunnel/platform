import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin'
import { GoogleCancelled, googleIdToken, GoogleUnavailable } from './google'

// The library's native module isn't in a test run: its four calls stand in for it.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn(), signOut: jest.fn() },
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
  isErrorWithCode: (error: unknown) => typeof error === 'object' && error !== null && 'code' in error,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE' },
}))

const native = jest.mocked(GoogleSignin)
const clients = { webClientId: 'web-client', iosClientId: 'ios-client' }

beforeEach(() => {
  jest.resetAllMocks()
  native.hasPlayServices.mockResolvedValue(true)
  native.signOut.mockResolvedValue(null)
})

describe('googleIdToken', () => {
  it('asks Google with the partner’s clients and gives back the ID token for the web client, forgetting Google’s session', async () => {
    native.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'id-token' } } as never)
    await expect(googleIdToken(clients)).resolves.toBe('id-token')
    expect(native.configure).toHaveBeenCalledWith({ webClientId: 'web-client', iosClientId: 'ios-client' })
    expect(native.signOut).toHaveBeenCalled()
  })

  it('tells a cancel apart from Google being unavailable', async () => {
    native.signIn.mockResolvedValue({ type: 'cancelled', data: null } as never)
    await expect(googleIdToken(clients)).rejects.toBeInstanceOf(GoogleCancelled)
    native.signIn.mockRejectedValue({ code: statusCodes.SIGN_IN_CANCELLED })
    await expect(googleIdToken(clients)).rejects.toBeInstanceOf(GoogleCancelled)
    native.hasPlayServices.mockRejectedValue({ code: statusCodes.PLAY_SERVICES_NOT_AVAILABLE })
    await expect(googleIdToken(clients)).rejects.toBeInstanceOf(GoogleUnavailable)
  })

  it('treats an answer without an ID token as unavailable, never as a sign-in', async () => {
    native.signIn.mockResolvedValue({ type: 'success', data: { idToken: null } } as never)
    await expect(googleIdToken(clients)).rejects.toBeInstanceOf(GoogleUnavailable)
  })
})
