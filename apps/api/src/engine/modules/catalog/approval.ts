import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { isUuid } from '#core/ids'
import { approvalRequired, approveProduct, countAwaitingApproval, sendBackProduct, setApprovalRequired } from '#db/scoped/approval'
import { withScope, type ScopedSql } from '#db/scoped/index'

// Approval of suppliers' products (ACCESS §7.2, CATALOG L): the Owner's switch and review. A supplier's own
// saves reach the queue through the catalogue and story services, as migration 0050's guard allows.

export const approvalAudit = {
  settingChanged: 'catalogue.approval_changed',
  // A supplier's approved product back in the queue, the cause as the reason (LOGGING.md §5).
  sentBackForApproval: 'product.sent_back_for_approval',
  approved: 'product.approved',
  sentBack: 'product.sent_back',
} as const

export const maxSendBackReason = 500

export type ApprovalResult<T> = { ok: true; value: T } | { ok: false; reason: 'NOT_FOUND' | 'REASON_REQUIRED' }

export interface ApprovalDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createApprovalService = ({ sql, context, actor, activity, facts, now }: ApprovalDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const required = () => inScope((tx) => approvalRequired(tx))
  const awaiting = () => inScope((tx) => countAwaitingApproval(tx, storeId))

  /** Turning it off leaves what is waiting in the queue: nothing unreviewed goes live by a switch. */
  const setRequired = (on: boolean) =>
    inScope(async (tx) => {
      if ((await approvalRequired(tx)) === on) return true
      await setApprovalRequired(tx, on)
      await activity.record(tx, entry(approvalAudit.settingChanged, { type: 'store', id: storeId, label: 'Supplier products need approval' }, on ? 'on' : 'off'))
      return true
    })

  const approve = (id: string): Promise<ApprovalResult<true>> =>
    inScope(async (tx) => {
      const done = isUuid(id) ? await approveProduct(tx, storeId, id, now()) : null
      if (!done) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(tx, entry(approvalAudit.approved, { type: 'product', id, label: done.name }, null))
      return { ok: true, value: true }
    })

  /** L3: always with a reason, which the supplier sees as "Sent back: [reason]". */
  const sendBack = (id: string, rawReason: string): Promise<ApprovalResult<true>> =>
    inScope(async (tx) => {
      const reason = rawReason.trim()
      if (reason === '' || reason.length > maxSendBackReason) return { ok: false, reason: 'REASON_REQUIRED' }
      const done = isUuid(id) ? await sendBackProduct(tx, storeId, id, reason, now()) : null
      if (!done) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(tx, entry(approvalAudit.sentBack, { type: 'product', id, label: done.name }, reason))
      return { ok: true, value: true }
    })

  return { required, awaiting, setRequired, approve, sendBack }
}
