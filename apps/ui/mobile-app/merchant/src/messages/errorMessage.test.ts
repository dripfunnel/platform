import { ApiError } from '../graphql'
import { errorMessage } from './errorMessage'

describe('errorMessage', () => {
  it('words a code by the context it happened in', () => {
    const wrong = new ApiError('INVALID_CREDENTIALS', 'x')
    expect(errorMessage(wrong, 'signIn')).toBe('That email and password don’t match. Check them, or reset your password.')
    expect(errorMessage(wrong, 'password')).toBe('That isn’t your current password.')
    expect(errorMessage(wrong, 'profile')).toBe('That isn’t your password.')
  })

  it('falls back to the code’s own words, then to one message', () => {
    expect(errorMessage(new ApiError('NO_RESPONSE', 'x'), 'signIn')).toBe('We couldn’t reach the server. Check your connection and try again.')
    expect(errorMessage(new ApiError('SOMETHING_NEW', 'x'))).toBe('Something went wrong. Try again in a moment.')
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again in a moment.')
  })

  it('fills in the facts the refusal carries, and says how many tries are left when it knows', () => {
    expect(errorMessage(new ApiError('LOCKED', 'x', { minutes: 15 }))).toBe('Too many wrong tries. Try again in 15 minutes.')
    expect(errorMessage(new ApiError('WRONG_CODE', 'x', { triesLeft: 3 }), 'code')).toBe('That code doesn’t match. 3 tries left before sign-in is paused.')
    expect(errorMessage(new ApiError('WRONG_CODE', 'x'), 'code')).toBe('That code doesn’t match.')
  })

  it('never shows the API’s own words', () => {
    expect(errorMessage(new ApiError('FORBIDDEN', 'Not allowed to open store 4f2a'))).toBe('You don’t have access to that.')
  })
})
