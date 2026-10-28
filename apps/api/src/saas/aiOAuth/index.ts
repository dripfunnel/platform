import type postgres from 'postgres'
import { newSessionId, hashSessionId } from '#auth/session'
import type { SecretBox } from '#auth/secretBox'
import type { AiProvider } from '#db/schema/saas'
import { withSystemScope } from '#db/scoped/index'
import { approveAttempt, consumeApprovedAttempt, deletePendingAttempt, lockCredential, markRejected, peekCredential, replaceAttempt, saveTokens, selectAttemptByState, type AiOwner, type AttemptRow, type LockedCredential } from '#db/scoped/aiOauth'
import type { ScopedSql } from '#db/scoped/index'
import { createPkce, OAuthError, type OAuthAvailability, type OAuthProviders, type OAuthTokens } from '#integrations/ai/index'
import { logEvent } from '#core/log'

// The AI sign-in flow of a store and a partner (docs/api/SAAS.md §9.3). Tokens are sealed on the way in and opened only here.
export const attemptMs = 10 * 60_000
export const finishMs = 10 * 60_000
/** A token this close to its end is renewed first. */
const renewWithinMs = 60_000

export interface AiOAuthDeps {
  sql: postgres.Sql
  secrets: SecretBox | null
  providers: OAuthProviders
  now: () => Date
}

export type BeginResult = { ok: true; url: string } | { ok: false; reason: 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'INVALID_INPUT' }
export type CallbackResult = { returnHost: string; kind: AiOwner['kind']; outcome: 'finish' | 'cancelled' | 'failed'; key?: string; attempt: AttemptRow } | null
export type TokenResult = { ok: true; token: string; accountId: string | null; provider: AiProvider } | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'UNAVAILABLE' | 'NOT_CONFIGURED' }

const isHost = (value: string): boolean => /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(value)

export const sealTokens = (secrets: SecretBox, t: OAuthTokens): Promise<string> => secrets.seal(JSON.stringify({ v: 1, accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, accountId: t.accountId }))

const openTokens = async (secrets: SecretBox, sealed: string): Promise<OAuthTokens | null> => {
  const plain = await secrets.open(sealed)
  if (!plain) return null
  try {
    const parsed: unknown = JSON.parse(plain)
    if (typeof parsed !== 'object' || parsed === null || !('accessToken' in parsed) || !('expiresAt' in parsed)) return null
    const refreshToken = 'refreshToken' in parsed && typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') return null
    const accountId = 'accountId' in parsed && typeof parsed.accountId === 'string' ? parsed.accountId : null
    return { accessToken: parsed.accessToken, refreshToken, expiresAt: parsed.expiresAt, accountLabel: null, accountId }
  } catch {
    return null
  }
}

export const createAiOAuth = ({ sql, secrets, providers, now }: AiOAuthDeps) => {
  const availability = (): { provider: AiProvider; availability: OAuthAvailability }[] =>
    (['anthropic', 'openai'] as const).map((provider) => ({ provider, availability: providers[provider].availability() }))

  const begin = async (a: { owner: AiOwner; provider: AiProvider; returnHost: string; startedBy: string; credentialId?: string | null }): Promise<BeginResult> => {
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    if (!isHost(a.returnHost)) return { ok: false, reason: 'INVALID_INPUT' }
    const adapter = providers[a.provider]
    if (!adapter.availability().available) return { ok: false, reason: 'UNAVAILABLE' }
    const state = newSessionId()
    const { verifier, challenge } = await createPkce()
    const url = adapter.authorizeUrl({ state, challenge })
    const stateHash = await hashSessionId(state)
    const verifierEnc = await secrets.seal(verifier)
    const dropped = await withSystemScope(sql, (tx) =>
      replaceAttempt(tx, { owner: a.owner, provider: a.provider, credentialId: a.credentialId ?? null, stateHash, verifierEnc, returnHost: a.returnHost, startedBy: a.startedBy, expiresAt: new Date(now().getTime() + attemptMs) }),
    )
    // A sign-in that was approved but never finished is replaced: its grant is revoked, not left live.
    for (const d of dropped) await revoke(d.provider, d.tokens_enc)
    return { ok: true, url }
  }

  /** The provider's answer, as its query. Null when the state is unknown or expired: nothing is said about which. */
  const callback = async (query: URLSearchParams): Promise<CallbackResult> => {
    const state = query.get('state') ?? ''
    if (!/^[0-9a-f]{64}$/.test(state) || !secrets) return null
    const stateHash = await hashSessionId(state)
    const attempt = await withSystemScope(sql, (tx) => selectAttemptByState(tx, stateHash))
    if (!attempt || attempt.expires_at <= now()) return null
    const result = (outcome: 'finish' | 'cancelled' | 'failed', key?: string) => ({ returnHost: attempt.return_host, kind: attempt.owner_kind, outcome, ...(key ? { key } : {}), attempt })
    const fail = async (outcome: 'cancelled' | 'failed') => {
      await withSystemScope(sql, (tx) => deletePendingAttempt(tx, attempt.id))
      return result(outcome)
    }
    const code = query.get('code')
    // Only the person pressing "Cancel" is a cancellation; any other refusal by the provider is a failure to say so.
    if (query.get('error') === 'access_denied') return fail('cancelled')
    if (query.get('error') || !code) return fail('failed')
    const verifier = await secrets.open(attempt.verifier_enc)
    if (!verifier) return fail('failed')
    let tokens: OAuthTokens
    try {
      tokens = await providers[attempt.provider].exchangeCode({ code, state, verifier })
    } catch (error) {
      // The row stays: a duplicate of this callback may be exchanging the same code, and a new sign-in replaces it anyway.
      logEvent({ event: 'ai_oauth_exchange_failed', api: 'hooks', code: error instanceof OAuthError ? error.code : 'unknown' })
      return result('failed')
    }
    const key = newSessionId()
    const sealed = await sealTokens(secrets, tokens)
    const approved = await withSystemScope(sql, async (tx) => approveAttempt(tx, attempt.id, { tokensEnc: sealed, accountLabel: tokens.accountLabel, finishHash: await hashSessionId(key), expiresAt: new Date(now().getTime() + finishMs) }))
    if (approved) return result('finish', key)
    // The attempt was replaced or answered meanwhile: these tokens belong to no row, so the grant is revoked.
    await revoke(attempt.provider, sealed)
    return result('failed')
  }

  /** What the person pasted back: the provider's address with `code` and `state`, or `code#state`; null when it is neither. */
  const parsePasted = (pasted: string): URLSearchParams | null => {
    const text = pasted.trim()
    if (text.length === 0 || text.length > 4000) return null
    if (/^https?:\/\//i.test(text)) {
      try {
        return new URL(text).searchParams
      } catch {
        return null
      }
    }
    const [code, state, ...rest] = text.split('#')
    return code && state && rest.length === 0 ? new URLSearchParams({ code, state }) : null
  }

  /** The pasted answer of the sign-in this owner's person started (and no one else's): the finish key, or null. */
  const submit = async (a: { owner: AiOwner; startedBy: string; pasted: string }): Promise<{ key: string } | { failed: 'cancelled' | 'failed' } | null> => {
    const query = parsePasted(a.pasted)
    const state = query?.get('state') ?? ''
    if (!query || !secrets || !/^[0-9a-f]{64}$/.test(state)) return null
    const stateHash = await hashSessionId(state)
    const attempt = await withSystemScope(sql, (tx) => selectAttemptByState(tx, stateHash))
    if (!attempt || attempt.owner_kind !== a.owner.kind || attempt.owner_id !== a.owner.id || attempt.started_by !== a.startedBy) return null
    const result = await callback(query)
    if (!result) return null
    return result.key ? { key: result.key } : { failed: result.outcome === 'cancelled' ? 'cancelled' : 'failed' }
  }

  /** The approved attempt, taken inside the caller's transaction so a failed write gives it back (SAAS §9.3). */
  const takeApproved = async (tx: ScopedSql, a: { owner: AiOwner; startedBy: string; key: string }): Promise<AttemptRow | null> => {
    if (!/^[0-9a-f]{64}$/.test(a.key)) return null
    return consumeApprovedAttempt(tx, { finishHash: await hashSessionId(a.key), owner: a.owner, startedBy: a.startedBy, now: now() })
  }

  /** The access token for a call: read without a lock, renewed under the row lock when due (SAAS §9.3). */
  const accessToken = async (owner: AiOwner, credentialId: string | null): Promise<TokenResult> => {
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    type Read = { done: TokenResult } | { due: OAuthTokens; provider: AiProvider }
    const read = async (row: LockedCredential | null): Promise<Read> => {
      if (!row || row.auth_type !== 'oauth') return { done: { ok: false, reason: 'NOT_FOUND' } }
      if (row.status === 'rejected') return { done: { ok: false, reason: 'EXPIRED' } }
      const tokens = await openTokens(secrets, row.key_enc)
      if (!tokens) return { done: { ok: false, reason: 'UNAVAILABLE' } }
      const left = tokens.expiresAt - now().getTime()
      if (left > renewWithinMs || (left > 0 && !tokens.refreshToken)) return { done: { ok: true, token: tokens.accessToken, accountId: tokens.accountId, provider: row.provider } }
      return { due: tokens, provider: row.provider }
    }
    const first = await read(await withSystemScope(sql, (tx) => peekCredential(tx, owner, credentialId)))
    if ('done' in first) return first.done
    try {
      return await withSystemScope(sql, async (tx): Promise<TokenResult> => {
        // A renewal stuck behind another's is refused rather than queued behind a provider that may be down.
        await tx.unsafe(`set local lock_timeout = '10s'`)
        const locked = await read(await lockCredential(tx, owner, credentialId))
        if ('done' in locked) return locked.done
        try {
          const renewed = await providers[locked.provider].refresh(locked.due)
          await saveTokens(tx, owner, credentialId, { keyEnc: await sealTokens(secrets, renewed), accountLabel: renewed.accountLabel, at: now() })
          return { ok: true, token: renewed.accessToken, accountId: renewed.accountId, provider: locked.provider }
        } catch (error) {
          if (error instanceof OAuthError && error.code === 'REFRESH_REJECTED') {
            await markRejected(tx, owner, credentialId, now())
            return { ok: false, reason: 'EXPIRED' }
          }
          logEvent({ event: 'ai_oauth_refresh_failed', api: 'system', code: error instanceof OAuthError ? error.code : 'unknown' })
          // The token still has a little life: use it rather than fail a call over a renewal that can wait.
          return locked.due.expiresAt > now().getTime() ? { ok: true, token: locked.due.accessToken, accountId: locked.due.accountId, provider: locked.provider } : { ok: false, reason: 'UNAVAILABLE' }
        }
      })
    } catch {
      return { ok: false, reason: 'UNAVAILABLE' }
    }
  }

  /** Revokes at the provider, best effort, before the caller deletes the account here. */
  const revoke = async (provider: AiProvider, sealed: string): Promise<void> => {
    if (!secrets) return
    const tokens = await openTokens(secrets, sealed)
    if (tokens) await providers[provider].revoke(tokens).catch(() => undefined)
  }

  /** Whether the provider accepts the token as it stands, for "Test". */
  const validate = (provider: AiProvider, tokens: { accessToken: string; accountId: string | null }) => providers[provider].chat(tokens).validateCredentials()

  return { availability, begin, callback, submit, takeApproved, accessToken, revoke, validate }
}

export type AiOAuth = ReturnType<typeof createAiOAuth>
