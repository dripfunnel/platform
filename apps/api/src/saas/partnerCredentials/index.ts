import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import { aiProviders, type AiProvider, type PartnerCredentialRow } from '#db/schema/saas'
import { deleteAiProfile, firstAiProfileId, insertAiProfile, selectDefaultAiKey, selectAiProfile, selectSealedAiKey, selectAiProfiles, setDefaultAiProfile, updateAiProfileTest } from '#db/scoped/partnerCredentials'
import { withScope, withSystemScope } from '#db/scoped/index'
import { anthropicProvider, type AiProvider as AiModel } from '#integrations/ai/provider'
import type { KeyCheck } from '#integrations/ai/provider'
import { partnerEntry } from '#saas/activity/index'

// Settings › Integrations, AI provider keys (ui/platform/FIRST-RELEASE.md §14.5; card #275). A key is sealed on the way in and
// never read back: the console sees its first characters and last four.

export const credentialAudit = {
  addAiKey: 'partner.ai_key_added',
  testAiKey: 'partner.ai_key_tested',
  setDefaultAiKey: 'partner.ai_key_default_set',
  removeAiKey: 'partner.ai_key_removed',
} as const

const keyShape: Record<AiProvider, RegExp> = { anthropic: /^sk-ant-[A-Za-z0-9_-]{20,200}$/, openai: /^sk-[A-Za-z0-9_-]{20,200}$/ }

const addInput = z.strictObject({ provider: z.enum(aiProviders), name: z.string().trim().min(1).max(60), key: z.string().trim().max(256) })

export type CredentialRefusal = 'INVALID_INPUT' | 'NAME_TAKEN' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND'

export interface PartnerCredentialsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** Asks the provider whether a key works; OpenAI has no check until #950, so it answers null. */
  checkKey: (provider: AiProvider, key: string) => Promise<KeyCheck | null>
  now: () => Date
}

const dto = (r: PartnerCredentialRow) => ({ id: r.id, provider: r.provider, name: r.name, keyPrefix: r.key_prefix, status: r.status, isDefault: r.is_default, lastTestedAt: r.last_tested_at })

// What the console shows of a key: enough to tell two apart, never enough to use one.
const prefixOf = (key: string): string => `${key.slice(0, key.startsWith('sk-ant-') ? 7 : 3)}…${key.slice(-4)}`

export const createPartnerCredentialsService = ({ sql, caller, facts, activity, secrets, checkKey, now }: PartnerCredentialsDeps) => {
  const partnerId = caller.partner.id
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
      const existing = await selectAiProfiles(tx, partnerId)
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
    const key = await secrets.open(sealed.key_enc)
    if (!key) return { ok: false, reason: 'NOT_CONFIGURED' }
    const checked = await checkKey(sealed.provider, key)
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
      const row = await selectAiProfile(tx, partnerId, id)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await deleteAiProfile(tx, id)
      if (row.is_default) {
        const next = await firstAiProfileId(tx, partnerId)
        if (next) await setDefaultAiProfile(tx, partnerId, next, now())
      }
      await activity.record(tx, entry({ action: credentialAudit.removeAiKey, target: { type: 'ai_key', id, label: row.name }, reason: null }))
      return { ok: true }
    })
  }

  return { aiKeys, addAiKey, testAiKey, setDefaultAiKey, removeAiKey }
}

/**
 * The model for a partner's AI runs (THIRD-PARTY-ACCESS §2.6): its default key when that is Anthropic's, else the Worker's
 * `AI_PROVIDER_KEY`. OpenAI has no adapter until #950, so an OpenAI default is not used here.
 */
export const partnerAiProvider = async (sql: postgres.Sql, secrets: SecretBox | null, partnerId: string, fallbackKey: string | undefined): Promise<AiModel | null> => {
  const row = secrets ? await withSystemScope(sql, (tx) => selectDefaultAiKey(tx, partnerId)) : null
  const key = row && secrets && row.provider === 'anthropic' ? await secrets.open(row.key_enc) : null
  const used = key ?? fallbackKey
  return used ? anthropicProvider(used) : null
}

export type PartnerCredentialsService = ReturnType<typeof createPartnerCredentialsService>
