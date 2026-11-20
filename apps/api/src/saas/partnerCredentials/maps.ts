import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import type { MapsKeyCheck, MapsKeyProblem } from '#core/mapsKey'
import { serialise, withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectOurMapsUsable } from '#db/scoped/mapsKey'
import { deleteMapsKey, insertMapsKey, selectMapsChoice, selectMapsKey, selectSealedMapsKey, updateMapsChoice, updateMapsKey, updateMapsKeyTest } from '#db/scoped/partnerCredentials'
import { partnerEntry } from '#saas/activity/index'
import { senderOf } from '#saas/sms/index'

// Settings › Integrations, Google Maps (#1612; THIRD-PARTY-ACCESS §2.12, §4): the partner's own browser key, and whose key its
// stores' maps use. The key is sealed on the way in and shown back as "AIza…abcd"; no entry or result carries it.

export const mapsAudit = {
  save: 'partner.maps_key_saved',
  test: 'partner.maps_key_tested',
  remove: 'partner.maps_key_removed',
  chosen: 'partner.maps_key_chosen',
} as const

const keyShape = z.string().trim().regex(/^AIza[0-9A-Za-z_-]{35}$/)
const saveInput = z.strictObject({ key: keyShape })

export type MapsKeyRefusal = 'INVALID_INPUT' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'DRIPFUNNEL_UNAVAILABLE' | 'NO_KEY'
type Problem = { problem?: MapsKeyProblem }
export type MapsKeyResult = ({ ok: true; status?: 'ok' | 'rejected' } & Problem) | ({ ok: false; reason: MapsKeyRefusal } & Problem)

/** "AIza…abcd": enough to tell two keys apart, never the key. */
export const mapsHintOf = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`

export const parseMapsKey = (raw: unknown): { ok: true; key: string } | { ok: false } => {
  const parsed = saveInput.safeParse(raw)
  return parsed.success ? { ok: true, key: parsed.data.key } : { ok: false }
}

/** What a key shows back, a partner's or DripFunnel's: never the key. */
export const mapsKeyDto = (r: { key_prefix: string; status: 'untested' | 'ok' | 'rejected'; last_tested_at: Date | null }) => ({ hint: r.key_prefix, status: r.status, lastTestedAt: r.last_tested_at })

export const mapsProblemOf = (check: Extract<MapsKeyCheck, { status: 'rejected' }>): Problem => ({ problem: check.problem })

export interface PartnerMapsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** One read-only request to Google with the key; locally and in tests, a stand-in. */
  checkMaps: (key: string) => Promise<MapsKeyCheck>
  now: () => Date
}

export const createPartnerMapsService = ({ sql, caller, facts, activity, secrets, checkMaps, now }: PartnerMapsDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const target = { type: 'maps_key', id: partnerId, label: 'Google Maps' }
  const lock = (tx: ScopedSql) => serialise(tx, `partner_maps:${partnerId}`)

  // DripFunnel's key is read in system scope; only whether it is there for this partner leaves it.
  const oursUsable = () => withSystemScope(sql, (tx) => selectOurMapsUsable(tx, partnerId))

  const account = async () => {
    const ours = await oursUsable()
    return withScope(sql, context, async (tx) => {
      const row = await selectMapsKey(tx, partnerId)
      const choice = await selectMapsChoice(tx, partnerId)
      return { key: row ? mapsKeyDto(row) : null, dripfunnel: ours, choice, sender: senderOf(choice, row?.status === 'ok', ours) }
    })
  }

  const save = async (raw: unknown): Promise<MapsKeyResult> => {
    const parsed = parseMapsKey(raw)
    if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const checked = await checkMaps(parsed.key)
    if (checked.status === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    if (checked.status === 'rejected') return { ok: false, reason: 'KEY_REJECTED', ...mapsProblemOf(checked) }
    const at = now()
    const write = { keyEnc: await secrets.seal(parsed.key), keyPrefix: mapsHintOf(parsed.key), settings: {}, status: 'ok' as const, testedAt: at, at }
    return withScope(sql, context, async (tx): Promise<MapsKeyResult> => {
      await lock(tx)
      const before = await selectMapsKey(tx, partnerId)
      if (before) await updateMapsKey(tx, before.id, write)
      else await insertMapsKey(tx, { ...write, partnerId, createdBy: actingName(caller) })
      await activity.record(tx, entry({ action: mapsAudit.save, target, reason: before ? 'replaced' : null, changes: [] }))
      return { ok: true, status: 'ok' }
    })
  }

  const test = async (): Promise<MapsKeyResult> => {
    // The sealed key is system-scope only, so the console path never holds it: the check reads it in its own scope.
    const sealed = await withSystemScope(sql, (tx) => selectSealedMapsKey(tx, partnerId))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const key = secrets ? await secrets.open(sealed) : null
    if (!key) return { ok: false, reason: 'NOT_CONFIGURED' }
    const checked = await checkMaps(key)
    if (checked.status === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    const status = checked.status === 'ok' ? 'ok' : 'rejected'
    return withScope(sql, context, async (tx): Promise<MapsKeyResult> => {
      await lock(tx)
      const row = await selectMapsKey(tx, partnerId)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateMapsKeyTest(tx, row.id, status, now())
      await activity.record(tx, entry({ action: mapsAudit.test, target, reason: checked.status === 'rejected' ? checked.problem : null, changes: [{ field: 'status', before: row.status, after: status }] }))
      return { ok: true, status, ...(checked.status === 'rejected' ? mapsProblemOf(checked) : {}) }
    })
  }

  /** Without its key, a store's maps fall to DripFunnel's if it is usable for the partner, else go: no key means no map. */
  const remove = (): Promise<MapsKeyResult> =>
    withScope(sql, context, async (tx): Promise<MapsKeyResult> => {
      await lock(tx)
      const row = await selectMapsKey(tx, partnerId)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await deleteMapsKey(tx, row.id)
      await activity.record(tx, entry({ action: mapsAudit.remove, target, reason: null, changes: [] }))
      return { ok: true }
    })

  /** Whose key the stores use while both are usable; `dripfunnel` only where Admin let this partner use it and it is Working. */
  const setChoice = async (choice: string): Promise<MapsKeyResult> => {
    if (choice !== 'own' && choice !== 'dripfunnel') return { ok: false, reason: 'INVALID_INPUT' }
    if (choice === 'dripfunnel' && !(await oursUsable())) return { ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE' }
    return withScope(sql, context, async (tx): Promise<MapsKeyResult> => {
      await lock(tx)
      const before = await selectMapsChoice(tx, partnerId)
      if (before === choice) return { ok: true }
      await updateMapsChoice(tx, partnerId, choice)
      await activity.record(tx, entry({ action: mapsAudit.chosen, target, reason: null, changes: [{ field: 'maps_account', before, after: choice }] }))
      return { ok: true }
    })
  }

  return { account, save, test, remove, setChoice }
}

export type PartnerMapsService = ReturnType<typeof createPartnerMapsService>
