import { enrolConfirm, enrolSendCode, sendCode, signIn, signInWithBackupCode, verifyCode } from '../../api/auth'
import { ApiError, isApiError, postSignOut, type RestOptions } from '../../graphql'
import { errorMessage, type ErrorContext } from '../../messages/errorMessage'
import type { SessionStore } from '../../session'
import type { PendingStore } from './pending'

export type FlowDeps = { rest: RestOptions; session: SessionStore; pending: PendingStore }

export type NextScreen = 'done' | 'second-factor' | 'enrol'

// ACCESS.md §4: a proven password opens a session as far as the person's second factor allows. A person with no
// second factor is signed in; one with it must give a code; an Owner without it is held at set-up.
export const startSignIn = async ({ rest, session, pending }: FlowDeps, email: string, password: string): Promise<NextScreen> => {
  const step = await signIn(rest, email, password)
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
  // A texted code is sent as the step opens; if that text fails the person can ask again from the screen.
  const hint = method === 'sms' ? await sendCode(rest, step.token).catch(() => null) : null
  pending.set({ step: 'second-factor', token: step.token, method, hint })
  return 'second-factor'
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

export const resendCode = async ({ rest, pending }: FlowDeps): Promise<void> => {
  const current = pending.get()
  const token = pendingToken(pending, 'second-factor')
  const hint = await sendCode(rest, token)
  if (current?.step === 'second-factor') pending.set({ ...current, hint })
}

export const sendEnrolCode = async ({ rest, pending }: FlowDeps, phone: string): Promise<void> => {
  const token = pendingToken(pending, 'enrol')
  const hint = await enrolSendCode(rest, token, phone.trim())
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
  if (token) await postSignOut(rest, token)
  await session.end('signedOut')
}
