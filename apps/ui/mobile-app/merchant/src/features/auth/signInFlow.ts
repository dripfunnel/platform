import { enrolConfirm, enrolSendCode, sendCode, signIn, signInWithBackupCode, signInWithGoogle, verifyCode, type CodeChannel, type SignInStep } from '../../api/auth'
import { ApiError, isApiError, postSignOut, type RestOptions } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { errorMessage, type ErrorContext } from '../../messages/errorMessage'
import type { SessionStore } from '../../session'
import { afterRefusedSend, noCodeChannels, unknownCodeChannels, type RefusedSend } from '../common/codeSend'
import type { Pending, PendingStore } from './pending'

export type FlowDeps = { rest: RestOptions; session: SessionStore; pending: PendingStore }

export type NextScreen = 'done' | 'second-factor' | 'enrol'

// ACCESS.md §4: a proven password opens a session as far as the person's second factor allows. A person with no
// second factor is signed in, Owners included (#1008); one with it must give a code.
export const startSignIn = async (deps: FlowDeps, email: string, password: string): Promise<NextScreen> => opened(deps, await signIn(deps.rest, email, password))

/** Google proves the address; what opens is what a password would open, second factor included (ACCESS.md §2). */
export const startGoogleSignIn = async (deps: FlowDeps, idToken: string): Promise<NextScreen> => opened(deps, await signInWithGoogle(deps.rest, idToken))

// With the partner's WhatsApp and SMS both off the API answers `done` for a phone-method person (ACCESS.md §4).
const opened = async (deps: FlowDeps, step: SignInStep): Promise<NextScreen> => {
  const { session, pending } = deps
  if (step.step === 'done') {
    pending.clear()
    await session.open(step.token)
    return 'done'
  }
  if (step.step === 'enrol') {
    pending.set({ step: 'enrol', token: step.token, phase: 'phone', hint: null, phone: '', codes: [], finalToken: null })
    return 'enrol'
  }
  const method = step.method ?? 'app'
  const channels = method === 'sms' ? (step.codeChannels ?? unknownCodeChannels) : noCodeChannels
  pending.set({ step: 'second-factor', token: step.token, method, sent: null, channels, opening: null })
  // A phone code is sent as the step opens; if it doesn't go, the screen says why and the person can ask again.
  if (method === 'sms') {
    const opening = await sendSignInCode(deps).catch((failed: unknown) => ({ text: failureOf(failed, 'code').message, wait: null }))
    if (opening) updateSecondFactor(pending, { opening: { text: opening.text, wait: opening.wait } })
  }
  return 'second-factor'
}

const updateSecondFactor = (pending: PendingStore, change: Partial<Extract<Pending, { step: 'second-factor' }>>): void => {
  const current = pending.get()
  if (current?.step === 'second-factor') pending.set({ ...current, ...change })
}

const pendingToken = (pending: PendingStore, step: 'second-factor' | 'enrol'): string => {
  const current = pending.get()
  if (!current || current.step !== step) throw new ExpiredSignInError()
  return current.token
}

/** The second step ran with no first step behind it: the person starts again at sign-in. */
export class ExpiredSignInError extends Error {}

export const submitCode = async ({ rest, session, pending }: FlowDeps, code: string): Promise<void> => {
  const token = await verifyCode(rest, pendingToken(pending, 'second-factor'), code.trim())
  pending.clear()
  await session.open(token)
}

export const submitBackupCode = async ({ rest, session, pending }: FlowDeps, code: string): Promise<void> => {
  const { token } = await signInWithBackupCode(rest, pendingToken(pending, 'second-factor'), code.trim())
  pending.clear()
  await session.open(token)
}

/**
 * Sends the sign-in code by the channel asked for, or the default. TOO_SOON and CHANNEL_OFF come back for the screen to
 * show (a closed channel is dropped from the links); any other refusal is thrown.
 */
export const sendSignInCode = async ({ rest, pending }: FlowDeps, asked?: CodeChannel): Promise<RefusedSend | null> => {
  const token = pendingToken(pending, 'second-factor')
  try {
    const answer = await sendCode(rest, token, asked)
    updateSecondFactor(pending, { sent: { channel: answer.channel, hint: answer.hint }, channels: answer.codeChannels, opening: null })
    return null
  } catch (failed) {
    const current = pending.get()
    const refused = afterRefusedSend(failed, asked, current?.step === 'second-factor' ? current.channels : unknownCodeChannels, t('errors.code.CHANNEL_OFF'))
    if (!refused) throw failed
    updateSecondFactor(pending, { channels: refused.channels })
    return refused
  }
}

export const sendEnrolCode = async ({ rest, pending }: FlowDeps, phone: string): Promise<void> => {
  const token = pendingToken(pending, 'enrol')
  const { hint } = await enrolSendCode(rest, token, phone.trim())
  pending.set({ step: 'enrol', token, phase: 'code', hint, phone: phone.trim(), codes: [], finalToken: null })
}

/** Turns the factor on. The ten backup codes come back once, so they are shown before the session opens. */
export const confirmEnrolCode = async ({ rest, pending }: FlowDeps, code: string): Promise<void> => {
  const current = pending.get()
  const token = pendingToken(pending, 'enrol')
  const done = await enrolConfirm(rest, token, code.trim())
  pending.set({ step: 'enrol', token, phase: 'codes', hint: current?.step === 'enrol' ? current.hint : null, phone: current?.step === 'enrol' ? current.phone : '', codes: done.backupCodes, finalToken: done.token })
}

export const finishEnrol = async ({ session, pending }: FlowDeps): Promise<void> => {
  const current = pending.get()
  if (current?.step !== 'enrol' || !current.finalToken) throw new ExpiredSignInError()
  pending.clear()
  await session.open(current.finalToken)
}

/** What a refused step shows: the screen to go to, or the one message for it. Never says whether an account exists. */
export type Failure = { locked: number | null; expired: boolean; message: string }

export const failureOf = (error: unknown, context: ErrorContext): Failure => {
  if (error instanceof ExpiredSignInError) return { locked: null, expired: true, message: errorMessage(new ApiError('INVALID_CREDENTIALS', 'Expired.'), 'code') }
  const minutes = isApiError(error, 'LOCKED') && typeof error.details.minutes === 'number' ? error.details.minutes : null
  // A pending session the API no longer knows (too long, or ended) sends the person back to sign in.
  const expired = context === 'code' && isApiError(error) && (error.code === 'INVALID_CREDENTIALS' || error.code === 'UNAUTHENTICATED')
  return { locked: minutes, expired, message: errorMessage(error, context) }
}

/** Signs out: the API ends the session, best effort, and the phone forgets it either way (REACT-NATIVE.md §5). */
export const signOut = async ({ rest, session }: Pick<FlowDeps, 'rest' | 'session'>): Promise<void> => {
  const token = session.token()
  if (token) await postSignOut(rest, '/api/auth/sign-out', token)
  await session.end('signedOut')
}
