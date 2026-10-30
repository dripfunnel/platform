import type { ScopedSql } from './index'

// A partner's Google client (#1046). The sealed secret is written here and read only in system scope (selectGoogleClient).

export interface GoogleSignInRow {
  client_id: string
  secret_hint: string
  enabled: boolean
  set_by: string
  set_at: Date
}

export const selectGoogleSignIn = async (tx: ScopedSql, partnerId: string): Promise<GoogleSignInRow | null> =>
  (await tx<GoogleSignInRow[]>`select client_id, secret_hint, enabled, set_by, set_at from partner_google_sign_in where partner_id = ${partnerId} for update`)[0] ?? null

// No upsert: its `excluded` read needs the sealed column, which the partner's role can't select.
export const saveGoogleSignInRow = async (tx: ScopedSql, input: { partnerId: string; clientId: string; secretEnc: string; secretHint: string; setBy: string; at: Date }, exists: boolean): Promise<void> => {
  if (exists) {
    await tx`
      update partner_google_sign_in set client_id = ${input.clientId}, secret_enc = ${input.secretEnc}, secret_hint = ${input.secretHint},
        enabled = true, set_by = ${input.setBy}, set_at = ${input.at}, updated_at = ${input.at}
      where partner_id = ${input.partnerId}
    `
    return
  }
  await tx`
    insert into partner_google_sign_in (partner_id, client_id, secret_enc, secret_hint, enabled, set_by, set_at, updated_at)
    values (${input.partnerId}, ${input.clientId}, ${input.secretEnc}, ${input.secretHint}, true, ${input.setBy}, ${input.at}, ${input.at})
  `
}

export const setGoogleSignInEnabled = async (tx: ScopedSql, partnerId: string, enabled: boolean, setBy: string, at: Date): Promise<void> => {
  await tx`update partner_google_sign_in set enabled = ${enabled}, set_by = ${setBy}, set_at = ${at}, updated_at = ${at} where partner_id = ${partnerId}`
}

/** System scope only: the partner's client while it is on, for the sign-in itself. */
export const selectGoogleClient = async (tx: ScopedSql, partnerId: string): Promise<{ client_id: string; secret_enc: string } | null> =>
  (await tx<{ client_id: string; secret_enc: string }[]>`select client_id, secret_enc from partner_google_sign_in where partner_id = ${partnerId} and enabled`)[0] ?? null
