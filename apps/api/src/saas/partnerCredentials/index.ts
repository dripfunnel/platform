import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import { aiProviders, type AiProvider, type PartnerCredentialRow } from '#db/schema/saas'
import { saveTokens } from '#db/scoped/aiOauth'
import { deleteAiProfile, firstAiProfileId, insertAiProfile, selectDefaultAiKey, selectAiProfile, selectSealedAiKey, selectAiProfiles, setDefaultAiProfile, updateAiProfileTest } from '#db/scoped/partnerCredentials'
import { serialise, withScope, withSystemScope } from '#db/scoped/index'
import { anthropicProvider, type AiProvider as AiModel } from '#integrations/ai/index'
import type { KeyCheck } from '#integrations/ai/index'
import { partnerEntry } from '#saas/activity/index'
import type { AiOAuth } from '#saas/aiOAuth/index'

// Settings › Integrations, AI provider keys (ui/platform/FIRST-RELEASE.md §14.5; card #275). A key is sealed on the way in and
// never read back: the console sees its first characters and last four.

export const credentialAudit = {
  addAiKey: 'partner.ai_key_added',
  testAiKey: 'partner.ai_key_tested',
  setDefaultAiKey: 'partner.ai_key_default_set',
  removeAiKey: 'partner.ai_key_removed',
  oauthStarted: 'partner.ai_oauth_started',
} as const

const keyShape: Record<AiProvider, RegExp> = { anthropic: /^sk-ant-[A-Za-z0-9_-]{20,200}$/, openai: /^sk-[A-Za-z0-9_-]{20,200}$/ }

const addInput = z.strictObject({ provider: z.enum(aiProviders), name: z.string().trim().min(1).max(60), key: z.string().trim().max(256) })

/** Profiles a partner may hold, so the list is bounded (AGENTS.md "Reliability"). */
export const maxAiProfiles = 20

/** Thrown inside the finish transaction so a refusal rolls the attempt back with it. */
class Refused extends Error {
  constructor(readonly reason: CredentialRefusal) {
    super(reason)
  }
}

export type CredentialRefusal = 'INVALID_INPUT' | 'LIMIT_REACHED' | 'NAME_TAKEN' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'OAUTH_UNAVAILABLE' | 'OAUTH_EXPIRED'

export interface PartnerCredentialsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** Asks the provider whether a key works; null means there is no check. */
  checkKey: (provider: AiProvider, key: string) => Promise<KeyCheck | null>
  /** The sign-in flow and the console host its redirect returns to; null where the Worker has none. */
  oauth?: AiOAuth | null
  host?: string | undefined
  now: () => Date
}

const dto = (r: PartnerCredentialRow) => ({ id: r.id, provider: r.provider, name: r.name, keyPrefix: r.key_prefix, status: r.status, isDefault: r.is_default, lastTestedAt: r.last_tested_at, authType: r.auth_type, accountLabel: r.account_label })

// What the console shows of a key: enough to tell two apart, never enough to use one.
const prefixOf = (key: string): string => `${key.slice(0, key.startsWith('sk-ant-') ? 7 : 3)}…${key.slice(-4)}`

export const createPartnerCredentialsService = ({ sql, caller, facts, activity, secrets, checkKey, oauth = null, host, now }: PartnerCredentialsDeps) => {
  const partnerId = caller.partner.id
  const owner = { kind: 'partner', id: partnerId, partnerId } as const
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const madeBy = actingName(caller)

  const aiKeys = () => withScope(sql, context, async (tx) => (await selectAiProfiles(tx, partnerId)).map(dto))

  type AddResult = { ok: true; id: string } | { ok: false; reason: CredentialRefusal }

  const addAiKey = async (raw: unknown): Promise<AddResult> => {
    const parsed = addInput.safeParse(raw)
    if (!parsed.success || !keyShape[parsed.data.provider].test(parsed.data.key)) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { provider, name, key } = parsed.data
    const checked = await checkKey(provider, key)
    if (checked === 'rejected') return { ok: false, reason: 'KEY_REJECTED' }
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    const keyEnc = await secrets.seal(key)
    const at = now()
    return withScope(sql, context, async (tx): Promise<AddResult> => {
      await serialise(tx, `partner_ai_keys:${partnerId}`)
      const existing = await selectAiProfiles(tx, partnerId)
      if (existing.length >= maxAiProfiles) return { ok: false, reason: 'LIMIT_REACHED' }
      if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { ok: false, reason: 'NAME_TAKEN' }
      let id: string
      try {
        id = await tx.savepoint((sp) =>
          insertAiProfile(sp, { partnerId, provider, name, keyEnc, keyPrefix: prefixOf(key), status: checked === 'ok' ? 'ok' : 'untested', testedAt: checked === 'ok' ? at : null, isDefault: existing.length === 0, createdBy: madeBy }),
        )
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'partner_credential_name_key') return { ok: false, reason: 'NAME_TAKEN' }
        throw error
      }
      await activity.record(tx, entry({ action: credentialAudit.addAiKey, target: { type: 'ai_key', id, label: name }, reason: null, changes: [{ field: 'provider', before: null, after: provider }] }))
      return { ok: true, id }
    })
  }

  type StatusResult = { ok: true; status: 'ok' | 'rejected' | 'untested' } | { ok: false; reason: CredentialRefusal }

  const testAiKey = async (id: string): Promise<StatusResult> => {
    if (!z.guid().safeParse(id).success) return { ok: false, reason: 'NOT_FOUND' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    // The sealed key is system-scope only, so the console path never holds it: the check reads it in its own scope.
    const sealed = await withSystemScope(sql, (tx) => selectSealedAiKey(tx, partnerId, id))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    let checked: KeyCheck | null
    if (sealed.auth_type === 'oauth') {
      const token = await oauth?.accessToken(owner, id)
      if (!token || (!token.ok && token.reason === 'NOT_CONFIGURED')) return { ok: false, reason: 'NOT_CONFIGURED' }
      if (!token.ok && token.reason === 'EXPIRED') return { ok: false, reason: 'OAUTH_EXPIRED' }
      checked = token.ok && oauth ? await oauth.validate(sealed.provider, { accessToken: token.token, accountId: token.accountId }) : 'unavailable'
    } else {
      const key = await secrets.open(sealed.key_enc)
      if (!key) return { ok: false, reason: 'NOT_CONFIGURED' }
      checked = await checkKey(sealed.provider, key)
    }
    if (checked === null) return { ok: true, status: 'untested' }
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    return withScope(sql, context, async (tx): Promise<StatusResult> => {
      const row = await selectAiProfile(tx, partnerId, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateAiProfileTest(tx, id, checked, now())
      await activity.record(tx, entry({ action: credentialAudit.testAiKey, target: { type: 'ai_key', id, label: row.name }, reason: null, changes: [{ field: 'status', before: row.status, after: checked }] }))
      return { ok: true, status: checked }
    })
  }

  type PlainResult = { ok: true } | { ok: false; reason: CredentialRefusal }

  const setDefaultAiKey = (id: string): Promise<PlainResult> => {
    if (!z.guid().safeParse(id).success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx): Promise<PlainResult> => {
      await serialise(tx, `partner_ai_keys:${partnerId}`)
      const row = await selectAiProfile(tx, partnerId, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      if (row.is_default) return { ok: true }
      await setDefaultAiProfile(tx, partnerId, id, now())
      await activity.record(tx, entry({ action: credentialAudit.setDefaultAiKey, target: { type: 'ai_key', id, label: row.name }, reason: null }))
      return { ok: true }
    })
  }

  const removeAiKey = (id: string): Promise<PlainResult> => {
    if (!z.guid().safeParse(id).success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx): Promise<PlainResult> => {
      await serialise(tx, `partner_ai_keys:${partnerId}`)
      const row = await selectAiProfile(tx, partnerId, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      if (row.auth_type === 'oauth') {
        const sealed = await withSystemScope(sql, (inner) => selectSealedAiKey(inner, partnerId, id))
        if (sealed) await oauth?.revoke(sealed.provider, sealed.key_enc)
      }
      await deleteAiProfile(tx, id)
      if (row.is_default) {
        const next = await firstAiProfileId(tx, partnerId)
        if (next) await setDefaultAiProfile(tx, partnerId, next, now())
      }
      await activity.record(tx, entry({ action: credentialAudit.removeAiKey, target: { type: 'ai_key', id, label: row.name }, reason: null }))
      return { ok: true }
    })
  }

  const providers = () => oauth?.availability() ?? []
  /** The person or staff member acting; a sign-in is refused without one (`started_by` is a uuid). */
  const startedBy = caller.user?.id ?? caller.staff?.id ?? null

  /** `id` names the sign-in profile a reconnect replaces; none starts a new one. */
  const beginOauth = async (provider: AiProvider, id: string | null): Promise<PlainResult & { url?: string }> => {
    if (!oauth || !host) return { ok: false, reason: 'NOT_CONFIGURED' }
    if (!startedBy) return { ok: false, reason: 'NOT_FOUND' }
    if (id !== null && !z.guid().safeParse(id).success) return { ok: false, reason: 'NOT_FOUND' }
    if (id !== null) {
      const row = await withScope(sql, context, (tx) => selectAiProfile(tx, partnerId, id))
      if (!row || row.auth_type !== 'oauth' || row.provider !== provider) return { ok: false, reason: 'NOT_FOUND' }
    }
    const begun = await oauth.begin({ owner, provider, returnHost: host, startedBy, credentialId: id })
    if (!begun.ok) return { ok: false, reason: begun.reason === 'UNAVAILABLE' ? 'OAUTH_UNAVAILABLE' : begun.reason }
    await withScope(sql, context, (tx) => activity.record(tx, entry({ action: credentialAudit.oauthStarted, target: { type: 'ai_key', id: id ?? provider, label: provider }, reason: null, changes: [{ field: 'provider', before: null, after: provider }] })))
    return { ok: true, url: begun.url }
  }

  const signInName: Record<AiProvider, string> = { anthropic: 'Claude sign-in', openai: 'ChatGPT sign-in' }

  /** `response` is what the person pasted back from the provider; only the person who started the sign-in can finish it. */
  const finishOauth = async (response: string): Promise<AddResult> => {
    if (!oauth || !startedBy) return { ok: false, reason: 'OAUTH_EXPIRED' }
    const submitted = await oauth.submit({ owner, startedBy, pasted: response })
    if (!submitted || !('key' in submitted)) return { ok: false, reason: 'OAUTH_EXPIRED' }
    const key = submitted.key
    const at = now()
    // Taking the attempt and storing the profile are one transaction: a failed write gives the attempt back.
    type Done = { result: AddResult; replaced: { provider: AiProvider; key_enc: string } | null }
    const done: Done = await withSystemScope(sql, async (tx): Promise<Done> => {
      const attempt = await oauth.takeApproved(tx, { owner, startedBy, key })
      if (!attempt?.tokens_enc) return { result: { ok: false, reason: 'OAUTH_EXPIRED' }, replaced: null }
      await serialise(tx, `partner_ai_keys:${partnerId}`)
      if (attempt.credential_id) {
        const row = await selectAiProfile(tx, partnerId, attempt.credential_id)
        if (!row) throw new Refused('NOT_FOUND')
        const replaced = await selectSealedAiKey(tx, partnerId, row.id)
        await saveTokens(tx, owner, row.id, { keyEnc: attempt.tokens_enc, accountLabel: attempt.account_label, at })
        await activity.record(tx, entry({ action: credentialAudit.addAiKey, target: { type: 'ai_key', id: row.id, label: row.name }, reason: null }))
        return { result: { ok: true, id: row.id }, replaced }
      }
      const existing = await selectAiProfiles(tx, partnerId)
      if (existing.length >= maxAiProfiles) throw new Refused('LIMIT_REACHED')
      const base = signInName[attempt.provider]
      const taken = new Set(existing.map((p) => p.name.toLowerCase()))
      let name = base
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`
      const id = await insertAiProfile(tx, { partnerId, provider: attempt.provider, name, keyEnc: attempt.tokens_enc, keyPrefix: '', status: 'ok', testedAt: at, isDefault: existing.length === 0, createdBy: madeBy, authType: 'oauth', accountLabel: attempt.account_label })
      await activity.record(tx, entry({ action: credentialAudit.addAiKey, target: { type: 'ai_key', id, label: name }, reason: null, changes: [{ field: 'provider', before: null, after: attempt.provider }, { field: 'auth_type', before: null, after: 'oauth' }] }))
      return { result: { ok: true, id }, replaced: null }
    }).catch((error: unknown) => {
      if (error instanceof Refused) return { result: { ok: false, reason: error.reason } as AddResult, replaced: null }
      throw error
    })
    // A refused finish (the profile limit) rolled the attempt back, so it can be tried again; a replaced sign-in is deleted here.
    if (done.replaced) await oauth.revoke(done.replaced.provider, done.replaced.key_enc)
    return done.result
  }

  return { aiKeys, addAiKey, testAiKey, setDefaultAiKey, removeAiKey, providers, beginOauth, finishOauth }
}

/**
 * The model for a partner's AI runs (THIRD-PARTY-ACCESS §2.6): its default Anthropic key. Only a partner with no key at all
 * falls back to the Worker's `AI_PROVIDER_KEY`; a default that is rejected, unreadable, OpenAI's or a sign-in
 * answers null, so the designer pauses and the platform never pays for a partner who has chosen its own key.
 */
export const partnerAiProvider = async (sql: postgres.Sql, secrets: SecretBox | null, partnerId: string, fallbackKey: string | undefined): Promise<AiModel | null> => {
  const row = await withSystemScope(sql, (tx) => selectDefaultAiKey(tx, partnerId))
  if (!row) return fallbackKey ? anthropicProvider(fallbackKey) : null
  if (row.provider !== 'anthropic' || row.status === 'rejected' || !secrets) return null
  const key = await secrets.open(row.key_enc)
  return key ? anthropicProvider(key) : null
}

export type PartnerCredentialsService = ReturnType<typeof createPartnerCredentialsService>
