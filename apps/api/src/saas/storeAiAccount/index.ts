import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import type { StoreCaller } from '#auth/storeCaller'
import { aiProviders, type AiProvider } from '#db/schema/saas'
import { withScope, withSystemScope } from '#db/scoped/index'
import { deleteStoreAiAccount, selectSealedStoreKey, selectStoreAiAccount, setStoreAiSwitch, updateStoreAiAccountTest, upsertStoreAiAccount, type StoreAiAccountRow } from '#db/scoped/storeAiAccount'
import type { KeyCheck } from '#integrations/ai/index'
import type { AiOAuth } from '#saas/aiOAuth/index'

// Storefront › AI (the Owner's `settings`): a store's own AI account, one sealed key, and the switch that lets it cover the
// plan's runs once they are used up (#950). The key is typed once and never read back.
export const storeAiAudit = {
  connected: 'store.ai_account_connected',
  oauthStarted: 'store.ai_oauth_started',
  tested: 'store.ai_account_tested',
  switched: 'store.ai_switch_changed',
  removed: 'store.ai_account_removed',
} as const

export type StoreAiRefusal = 'INVALID_INPUT' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'OAUTH_UNAVAILABLE' | 'OAUTH_EXPIRED'
export type StoreAiResult<T = object> = ({ ok: true } & T) | { ok: false; reason: StoreAiRefusal }

const keyShape: Record<AiProvider, RegExp> = { anthropic: /^sk-ant-[A-Za-z0-9_-]{20,200}$/, openai: /^sk-[A-Za-z0-9_-]{20,200}$/ }
const connectInput = z.strictObject({ provider: z.enum(aiProviders), key: z.string().trim().max(256) })
const prefixOf = (key: string): string => `${key.slice(0, key.startsWith('sk-ant-') ? 7 : 3)}…${key.slice(-4)}`

export interface StoreAiDeps {
  sql: postgres.Sql
  caller: StoreCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  checkKey: (provider: AiProvider, key: string) => Promise<KeyCheck>
  /** The sign-in flow; null where the Worker has none. */
  oauth?: AiOAuth | null
  /** The portal host the provider's redirect comes back to. */
  host?: string | undefined
  now: () => Date
}

export const createStoreAiService = ({ sql, caller, facts, activity, secrets, checkKey, oauth = null, host, now }: StoreAiDeps) => {
  const { storeId, partnerId } = caller.context
  const owner = { kind: 'store', id: storeId, partnerId } as const
  const entry = (action: string, changes: NonNullable<ActivityEntry['changes']> = []): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: caller.person.id,
    actorLabel: null,
    partnerId: caller.person.partnerId,
    storeId,
    sellerId: null,
    target: { type: 'ai_account', id: storeId, label: 'AI account' },
    changes,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const account = () => withScope(sql, caller.context, (tx) => selectStoreAiAccount(tx, storeId))

  const connect = async (raw: unknown): Promise<StoreAiResult> => {
    const parsed = connectInput.safeParse(raw)
    if (!parsed.success || !keyShape[parsed.data.provider].test(parsed.data.key)) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { provider, key } = parsed.data
    const checked = await checkKey(provider, key)
    if (checked === 'rejected') return { ok: false, reason: 'KEY_REJECTED' }
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    const keyEnc = await secrets.seal(key)
    const at = now()
    // A key replaces a sign-in: its grant is revoked rather than left live at the provider.
    const before = await withSystemScope(sql, (tx) => selectSealedStoreKey(tx, storeId))
    if (before?.auth_type === 'oauth') await oauth?.revoke(before.provider, before.key_enc)
    await withSystemScope(sql, (tx) => upsertStoreAiAccount(tx, { storeId, provider, keyEnc, keyPrefix: prefixOf(key), status: 'ok', testedAt: at, connectedBy: caller.person.name, at }))
    await withScope(sql, caller.context, (tx) => activity.record(tx, entry(storeAiAudit.connected, [{ field: 'provider', before: null, after: provider }])))
    return { ok: true }
  }

  const checkSealedKey = async (sealed: { provider: AiProvider; key_enc: string }): Promise<KeyCheck | 'missing'> => {
    const key = await secrets?.open(sealed.key_enc)
    return key ? checkKey(sealed.provider, key) : 'missing'
  }

  /** A sign-in works when its token can be renewed (if due) and the provider then accepts it. */
  const checkSignIn = async (provider: AiProvider): Promise<KeyCheck | 'expired' | 'missing'> => {
    const token = await oauth?.accessToken(owner, null)
    if (!token || (!token.ok && token.reason === 'NOT_CONFIGURED')) return 'missing'
    if (!token.ok) return token.reason === 'EXPIRED' ? 'expired' : 'unavailable'
    return oauth ? oauth.validate(provider, { accessToken: token.token, accountId: token.accountId }) : 'unavailable'
  }

  const test = async (): Promise<StoreAiResult<{ status: 'ok' | 'rejected' }>> => {
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const sealed = await withSystemScope(sql, (tx) => selectSealedStoreKey(tx, storeId))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const checked = sealed.auth_type === 'oauth' ? await checkSignIn(sealed.provider) : await checkSealedKey(sealed)
    if (checked === 'expired') return { ok: false, reason: 'OAUTH_EXPIRED' }
    if (checked === 'missing') return { ok: false, reason: 'NOT_CONFIGURED' }
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    await withSystemScope(sql, (tx) => updateStoreAiAccountTest(tx, storeId, checked, now()))
    await withScope(sql, caller.context, (tx) => activity.record(tx, entry(storeAiAudit.tested, [{ field: 'status', before: sealed.status, after: checked }])))
    return { ok: true, status: checked }
  }

  const setSwitch = async (on: boolean): Promise<StoreAiResult> =>
    withSystemScope(sql, async (tx) => {
      const before = await selectSealedStoreKey(tx, storeId)
      if (!before) return { ok: false, reason: 'NOT_FOUND' }
      if (before.use_when_plan_used === on) return { ok: true }
      await setStoreAiSwitch(tx, storeId, on, now())
      await activity.record(tx, entry(storeAiAudit.switched, [{ field: 'use_when_plan_used', before: String(before.use_when_plan_used), after: String(on) }]))
      return { ok: true }
    })

  const remove = async (): Promise<StoreAiResult> =>
    withSystemScope(sql, async (tx) => {
      const before = await selectSealedStoreKey(tx, storeId)
      if (!before) return { ok: false, reason: 'NOT_FOUND' }
      if (before.auth_type === 'oauth') await oauth?.revoke(before.provider, before.key_enc)
      await deleteStoreAiAccount(tx, storeId)
      await activity.record(tx, entry(storeAiAudit.removed))
      return { ok: true }
    })

  const providers = () => oauth?.availability() ?? []

  const beginOauth = async (provider: AiProvider): Promise<StoreAiResult<{ url: string }>> => {
    if (!oauth || !host) return { ok: false, reason: 'NOT_CONFIGURED' }
    const begun = await oauth.begin({ owner, provider, returnHost: host, startedBy: caller.person.id })
    if (!begun.ok) return { ok: false, reason: begun.reason === 'UNAVAILABLE' ? 'OAUTH_UNAVAILABLE' : begun.reason }
    await withScope(sql, caller.context, (tx) => activity.record(tx, entry(storeAiAudit.oauthStarted, [{ field: 'provider', before: null, after: provider }])))
    return { ok: true, url: begun.url }
  }

  /** `response` is what the person pasted back from the provider; only the person who started the sign-in can finish it. */
  const finishOauth = async (response: string): Promise<StoreAiResult> => {
    if (!oauth) return { ok: false, reason: 'OAUTH_EXPIRED' }
    const submitted = await oauth.submit({ owner, startedBy: caller.person.id, pasted: response })
    if (!submitted || !('key' in submitted)) return { ok: false, reason: 'OAUTH_EXPIRED' }
    const key = submitted.key
    const at = now()
    // Taking the attempt and storing the account are one transaction: a failed write gives the attempt back.
    const done = await withSystemScope(sql, async (tx) => {
      const attempt = await oauth.takeApproved(tx, { owner, startedBy: caller.person.id, key })
      if (!attempt?.tokens_enc) return null
      const before = await selectSealedStoreKey(tx, storeId)
      await upsertStoreAiAccount(tx, { storeId, provider: attempt.provider, keyEnc: attempt.tokens_enc, keyPrefix: '', status: 'ok', testedAt: at, connectedBy: caller.person.name, at, authType: 'oauth', accountLabel: attempt.account_label })
      await activity.record(tx, entry(storeAiAudit.connected, [{ field: 'provider', before: before?.provider ?? null, after: attempt.provider }, { field: 'auth_type', before: before?.auth_type ?? null, after: 'oauth' }]))
      return { before }
    })
    if (done === null) return { ok: false, reason: 'OAUTH_EXPIRED' }
    // A sign-in it replaces is revoked at the provider rather than left live.
    if (done.before?.auth_type === 'oauth') await oauth.revoke(done.before.provider, done.before.key_enc)
    return { ok: true }
  }

  return { account, connect, test, setSwitch, remove, providers, beginOauth, finishOauth }
}

export type StoreAiService = ReturnType<typeof createStoreAiService>
export type { StoreAiAccountRow }
