import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, partnerContextOf, type PartnerCaller } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import { saveGoogleSignInRow, selectGoogleSignIn, setGoogleSignInEnabled } from '#db/scoped/googleSignIn'
import { withScope } from '#db/scoped/index'
import { selectPartnerHosts } from '#db/scoped/partners'
import { partnerEntry } from '#saas/activity/index'

// Settings › Integrations, Google sign-in (#1046; THIRD-PARTY-ACCESS §2.9): the partner's own Google client for
// "Continue with Google" on its portal. The secret is sealed on the way in and shown back as its ends only.

export const googleSignInAudit = {
  save: 'partner.google_sign_in_saved',
  turnOff: 'partner.google_sign_in_turned_off',
} as const

const saveInput = z.strictObject({
  clientId: z.string().trim().max(200).regex(/^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$/),
  // Google's client secrets are `GOCSPX-` and 28 more; older ones are 24 characters of the same alphabet.
  clientSecret: z.string().trim().regex(/^[A-Za-z0-9_-]{20,100}$/),
})

export type GoogleSignInRefusal = 'INVALID_INPUT' | 'NOT_CONFIGURED' | 'NOT_FOUND'

const hintOf = (secret: string) => `${secret.slice(0, 7)}…${secret.slice(-4)}`

export interface GoogleSignInDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  now: () => Date
}

export const createGoogleSignInService = ({ sql, caller, facts, activity, secrets, now }: GoogleSignInDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const target = { type: 'google_sign_in', id: partnerId, label: 'Google sign-in' }

  const status = () =>
    withScope(sql, context, async (tx) => {
      const row = await selectGoogleSignIn(tx, partnerId)
      const host = (await selectPartnerHosts(tx, partnerId)).find((h) => h.kind === 'portal')?.host ?? null
      return {
        enabled: row?.enabled ?? false,
        clientId: row?.client_id ?? null,
        secretHint: row?.secret_hint ?? null,
        setBy: row?.set_by ?? null,
        setAt: row?.set_at ?? null,
        // What the partner registers in Google Cloud; null until it has a portal host.
        redirectUri: host ? `https://${host}/api/auth/google/callback` : null,
      }
    })

  const save = async (raw: unknown): Promise<{ ok: true } | { ok: false; reason: GoogleSignInRefusal }> => {
    const parsed = saveInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { clientId, clientSecret } = parsed.data
    const secretEnc = await secrets.seal(clientSecret)
    return withScope(sql, context, async (tx) => {
      const before = await selectGoogleSignIn(tx, partnerId)
      await saveGoogleSignInRow(tx, { partnerId, clientId, secretEnc, secretHint: hintOf(clientSecret), setBy: actingName(caller), at: now() }, before !== null)
      await activity.record(tx, entry({ action: googleSignInAudit.save, target, reason: null, changes: [{ field: 'client_id', before: before?.client_id ?? null, after: clientId }] }))
      return { ok: true as const }
    })
  }

  const turnOff = () =>
    withScope(sql, context, async (tx): Promise<{ ok: true } | { ok: false; reason: GoogleSignInRefusal }> => {
      const row = await selectGoogleSignIn(tx, partnerId)
      if (!row?.enabled) return { ok: false, reason: 'NOT_FOUND' }
      await setGoogleSignInEnabled(tx, partnerId, false, actingName(caller), now())
      await activity.record(tx, entry({ action: googleSignInAudit.turnOff, target, reason: null }))
      return { ok: true }
    })

  return { status, save, turnOff }
}

export type GoogleSignInService = ReturnType<typeof createGoogleSignInService>
