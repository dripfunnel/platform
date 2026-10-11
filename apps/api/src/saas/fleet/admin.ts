import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { StaffMember } from '#auth/staff'
import type { Keyset } from '#core/cursor'
import { countStoresByState, insertRollout, selectReleaseForRollout, selectRollout, selectRollouts, setRolloutState, type RolloutRow, type StoreUpgradeState } from '#db/scoped/coreRollouts'
import { uniqueViolation, withScope, type ScopedSql } from '#db/scoped/index'
import { decodePage, pageOf, reasonText, staffEntry, type PageRequest } from '#saas/staff/index'

// The fleet on the Admin API (SAAS §10, §13: Engineer on call and Super admin): core rollouts started, paused, resumed
// and rolled back, each audited with its reason; the cron's tick does the work (rollout.ts).

export const fleetAudit = {
  started: 'core_rollout.started',
  paused: 'core_rollout.paused',
  resumed: 'core_rollout.resumed',
  rolledBack: 'core_rollout.rolled_back',
} as const

export type FleetRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'ROLLOUT_ACTIVE' | 'WRONG_STATE'
export type FleetResult = { ok: true; rollout: RolloutView } | { ok: false; code: FleetRefusal }

export interface RolloutView extends RolloutRow {
  stores: { state: StoreUpgradeState; n: number }[]
}

export interface FleetDeps {
  sql: postgres.Sql
  staff: StaffMember
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

const pageSize = 25

export const createFleetService = ({ sql, staff, activity, facts, now }: FleetDeps) => {
  const asStaff = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, { caller: { kind: 'staff', staffId: staff.id } }, work)
  const entry = staffEntry(staff, facts)
  const view = async (tx: ScopedSql, row: RolloutRow): Promise<RolloutView> => ({ ...row, stores: await countStoresByState(tx, row.id) })
  const audit = (tx: ScopedSql, row: RolloutRow, action: string, reason: string, before: string) =>
    activity.record(tx, entry({ action, reason, target: { type: 'core_rollout', id: row.id, label: row.version }, visibility: 'staff', changes: [{ field: 'state', before, after: row.state }] }))

  const list = async (page: PageRequest) => {
    const decoded = decodePage(page, pageSize)
    if (!decoded.ok) return null
    return asStaff(async (tx) => {
      const after = decoded.after ? { at: decoded.after.occurredAt, id: decoded.after.id } : undefined
      const rows = await selectRollouts(tx, { after, limit: decoded.limit })
      const { rows: items, pageInfo } = pageOf(rows, { ...decoded, before: undefined }, (r): Keyset => ({ occurredAt: r.started_at, id: r.id }))
      return { items: await Promise.all(items.map((r) => view(tx, r))), pageInfo }
    })
  }

  const get = (id: string) => asStaff(async (tx) => {
    const row = await selectRollout(tx, id)
    return row ? view(tx, row) : null
  })

  /** One rollout at a time: a second is refused while one is running, paused or not. */
  const start = async (input: { version: string; security: boolean; reason: string }): Promise<FleetResult> => {
    const reason = reasonText.safeParse(input.reason)
    if (!reason.success || !/^\d+\.\d+\.\d+$/.test(input.version)) return { ok: false, code: 'INVALID_INPUT' }
    try {
      return await asStaff(async (tx): Promise<FleetResult> => {
        const release = await selectReleaseForRollout(tx, input.version)
        if (!release) return { ok: false, code: 'NOT_FOUND' }
        const id = await insertRollout(tx, { version: release.version, security: release.security || input.security, by: staff.id, reason: reason.data, at: now() })
        const row = await selectRollout(tx, id)
        if (!row) return { ok: false, code: 'NOT_FOUND' }
        await audit(tx, row, fleetAudit.started, reason.data, 'none')
        return { ok: true, rollout: await view(tx, row) }
      })
    } catch (error) {
      if (uniqueViolation(error, 'core_rollout_one_active')) return { ok: false, code: 'ROLLOUT_ACTIVE' }
      throw error
    }
  }

  const change = (id: string, rawReason: string, action: string, next: (row: RolloutRow) => Parameters<typeof setRolloutState>[2] | null): Promise<FleetResult> => {
    const reason = reasonText.safeParse(rawReason)
    if (!reason.success) return Promise.resolve({ ok: false, code: 'INVALID_INPUT' })
    return asStaff(async (tx): Promise<FleetResult> => {
      const row = await selectRollout(tx, id, true)
      if (!row) return { ok: false, code: 'NOT_FOUND' }
      const to = next(row)
      if (!to) return { ok: false, code: 'WRONG_STATE' }
      await setRolloutState(tx, row.id, to)
      const after = await selectRollout(tx, row.id)
      if (!after) return { ok: false, code: 'NOT_FOUND' }
      await audit(tx, after, action, reason.data, row.state)
      return { ok: true, rollout: await view(tx, after) }
    })
  }

  /** No new store starts; those already upgrading finish. */
  const pause = (id: string, reason: string) =>
    change(id, reason, fleetAudit.paused, (r) => (r.state === 'canary' || r.state === 'waves' ? { state: 'paused', pausedState: r.state } : null))

  const resume = (id: string, reason: string) => change(id, reason, fleetAudit.resumed, (r) => (r.state === 'paused' && r.paused_state ? { state: r.paused_state } : null))

  /** No new store starts, and the tick puts every store that went live on this version back on the build before it. */
  const rollBack = (id: string, reason: string) =>
    change(id, reason, fleetAudit.rolledBack, (r) => (r.state === 'canary' || r.state === 'waves' || r.state === 'paused' || r.state === 'done' ? { state: 'rolled_back', finishedAt: now() } : null))

  return { list, get, start, pause, resume, rollBack }
}

export type FleetService = ReturnType<typeof createFleetService>
