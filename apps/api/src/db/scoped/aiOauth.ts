import type { AiProvider } from '../schema/saas'
import type { ScopedSql } from './index'

// AI sign-in attempts and the sealed tokens of a signed-in account (#950; migration 0370). System scope only: the browser that
// returns from the provider has no session of its own, and no request role may read a token.
export type AiOwner = { kind: 'store'; id: string; partnerId: string } | { kind: 'partner'; id: string; partnerId: string }

export interface AttemptRow {
  id: string
  owner_kind: AiOwner['kind']
  owner_id: string
  partner_id: string
  provider: AiProvider
  credential_id: string | null
  status: 'pending' | 'approved'
  verifier_enc: string
  tokens_enc: string | null
  account_label: string | null
  started_by: string
  expires_at: Date
}

/** One live attempt per owner: starting again replaces it, and answers the sealed tokens of an approved one so they can be revoked. */
export const replaceAttempt = async (tx: ScopedSql, a: { owner: AiOwner; provider: AiProvider; credentialId: string | null; stateHash: string; verifierEnc: string; startedBy: string; expiresAt: Date }): Promise<{ provider: AiProvider; tokens_enc: string }[]> => {
  const dropped = await tx<{ provider: AiProvider; tokens_enc: string | null }[]>`delete from ai_oauth_attempt where owner_kind = ${a.owner.kind} and owner_id = ${a.owner.id} returning provider, tokens_enc`
  await tx`
    insert into ai_oauth_attempt (owner_kind, owner_id, partner_id, provider, credential_id, status, state_hash, verifier_enc, started_by, expires_at)
    values (${a.owner.kind}, ${a.owner.id}, ${a.owner.partnerId}, ${a.provider}, ${a.credentialId}, 'pending', ${a.stateHash}, ${a.verifierEnc}, ${a.startedBy}, ${a.expiresAt})`
  return dropped.flatMap((d) => (d.tokens_enc ? [{ provider: d.provider, tokens_enc: d.tokens_enc }] : []))
}

export const selectAttemptByState = async (tx: ScopedSql, stateHash: string): Promise<AttemptRow | null> =>
  (await tx<AttemptRow[]>`select * from ai_oauth_attempt where state_hash = ${stateHash} and status = 'pending' for update`)[0] ?? null

/** The state is spent here, so the same callback can't be played twice. */
export const approveAttempt = async (tx: ScopedSql, id: string, a: { tokensEnc: string; accountLabel: string | null; finishHash: string; expiresAt: Date }): Promise<boolean> =>
  (await tx`update ai_oauth_attempt set status = 'approved', state_hash = null, tokens_enc = ${a.tokensEnc}, account_label = ${a.accountLabel}, finish_hash = ${a.finishHash}, expires_at = ${a.expiresAt} where id = ${id} and status = 'pending' returning 1`).length > 0

/** Only a pending one: an approved attempt is the other callback's, and waits for its owner's finish. */
export const deletePendingAttempt = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from ai_oauth_attempt where id = ${id} and status = 'pending'`
}

/** Taken once, by the owner and the person who started it: the finish key alone is not enough. */
export const consumeApprovedAttempt = async (tx: ScopedSql, a: { finishHash: string; owner: AiOwner; startedBy: string; now: Date }): Promise<AttemptRow | null> =>
  (
    await tx<AttemptRow[]>`
      delete from ai_oauth_attempt where finish_hash = ${a.finishHash} and owner_kind = ${a.owner.kind} and owner_id = ${a.owner.id} and started_by = ${a.startedBy}
        and status = 'approved' and expires_at > ${a.now} returning *`
  )[0] ?? null

export interface LockedCredential {
  id: string | null
  provider: AiProvider
  auth_type: 'api_key' | 'oauth'
  status: 'untested' | 'ok' | 'rejected'
  key_enc: string
}

export const peekCredential = async (tx: ScopedSql, owner: AiOwner, credentialId: string | null): Promise<LockedCredential | null> =>
  owner.kind === 'store'
    ? ((await tx<LockedCredential[]>`select null::uuid as id, provider, auth_type, status, key_enc from store_ai_account where store_id = ${owner.id}`)[0] ?? null)
    : ((await tx<LockedCredential[]>`select id, provider, auth_type, status, key_enc from partner_credential where partner_id = ${owner.id} and kind = 'ai' and id = ${credentialId}`)[0] ?? null)

/** Locks the owner's credential for a refresh, so two requests can't spend one rotating refresh token. A partner names the profile. */
export const lockCredential = async (tx: ScopedSql, owner: AiOwner, credentialId: string | null): Promise<LockedCredential | null> =>
  owner.kind === 'store'
    ? ((await tx<LockedCredential[]>`select null::uuid as id, provider, auth_type, status, key_enc from store_ai_account where store_id = ${owner.id} for update`)[0] ?? null)
    : ((await tx<LockedCredential[]>`select id, provider, auth_type, status, key_enc from partner_credential where partner_id = ${owner.id} and kind = 'ai' and id = ${credentialId} for update`)[0] ?? null)

export const saveTokens = async (tx: ScopedSql, owner: AiOwner, credentialId: string | null, a: { keyEnc: string; accountLabel: string | null; at: Date }): Promise<void> => {
  if (owner.kind === 'store') await tx`update store_ai_account set key_enc = ${a.keyEnc}, account_label = coalesce(${a.accountLabel}, account_label), status = 'ok', last_tested_at = ${a.at}, updated_at = ${a.at} where store_id = ${owner.id}`
  else await tx`update partner_credential set key_enc = ${a.keyEnc}, account_label = coalesce(${a.accountLabel}, account_label), status = 'ok', last_tested_at = ${a.at}, updated_at = ${a.at} where id = ${credentialId} and partner_id = ${owner.id}`
}

export const markRejected = async (tx: ScopedSql, owner: AiOwner, credentialId: string | null, at: Date): Promise<void> => {
  if (owner.kind === 'store') await tx`update store_ai_account set status = 'rejected', last_tested_at = ${at}, updated_at = ${at} where store_id = ${owner.id}`
  else await tx`update partner_credential set status = 'rejected', last_tested_at = ${at}, updated_at = ${at} where id = ${credentialId} and partner_id = ${owner.id}`
}
