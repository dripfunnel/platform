import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Settings › Integrations, Google sign-in (#1046): the partner's own Google client for its portal. The secret goes
// up once and comes back as its first and last characters.

const statusSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().nullable(),
  secretHint: z.string().nullable(),
  setBy: z.string().nullable(),
  setAt: z.string().nullable(),
  redirectUri: z.string().nullable(),
})
export type GoogleSignInStatus = z.infer<typeof statusSchema>

export const googleSignInRefusals = ['INVALID_INPUT', 'NOT_CONFIGURED', 'NOT_FOUND'] as const
export type GoogleSignInRefusal = (typeof googleSignInRefusals)[number]
export type GoogleSignInResult = { ok: true } | { ok: false; reason: GoogleSignInRefusal }

/** Google's own shapes, checked here so the dialog can say what's wrong before sending. */
export const googleClientIdShape = /^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$/
export const googleSecretShape = /^[A-Za-z0-9_-]{20,100}$/

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable() })

const resultOf = (r: z.infer<typeof resultSchema> | undefined, field: string): GoogleSignInResult => {
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  if (r.ok) return { ok: true }
  const known = googleSignInRefusals.find((code) => code === r.reason)
  if (!known) throw new ApiError(r.reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return { ok: false, reason: known }
}

export const loadGoogleSignIn = async (): Promise<GoogleSignInStatus> =>
  (await query(`{ partnerGoogleSignIn { enabled clientId secretHint setBy setAt redirectUri } }`, z.object({ partnerGoogleSignIn: statusSchema }))).partnerGoogleSignIn

export const saveGoogleSignIn = async (input: { clientId: string; clientSecret: string }): Promise<GoogleSignInResult> =>
  resultOf(
    (await query(`mutation Save($clientId: String!, $clientSecret: String!) { savePartnerGoogleSignIn(clientId: $clientId, clientSecret: $clientSecret) { ok reason } }`, z.object({ savePartnerGoogleSignIn: resultSchema }), input)).savePartnerGoogleSignIn,
    'savePartnerGoogleSignIn',
  )

export const turnOffGoogleSignIn = async (): Promise<GoogleSignInResult> =>
  resultOf((await query(`mutation { turnOffPartnerGoogleSignIn { ok reason } }`, z.object({ turnOffPartnerGoogleSignIn: resultSchema }))).turnOffPartnerGoogleSignIn, 'turnOffPartnerGoogleSignIn')
