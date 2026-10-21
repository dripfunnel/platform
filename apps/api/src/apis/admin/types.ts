import type { PageInfo } from '#saas/activity/index'
import { unauthenticated } from '../graphql/scope'
import { builder } from './builder'

/** The cursor page every console list returns (ui/admin/FIRST-RELEASE.md §12). */
export const PageInfoType = builder.objectRef<PageInfo>('PageInfo').implement({
  fields: (t) => ({
    startCursor: t.exposeString('startCursor', { nullable: true }),
    endCursor: t.exposeString('endCursor', { nullable: true }),
    hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
    hasNextPage: t.exposeBoolean('hasNextPage'),
  }),
})

export interface Permission {
  allowed: boolean
  reason: string | null
  failingChecks: string[] | null
}

/** What a record says about one action on it: allowed, or refused with a stable code (decided on #19). */
export const PermissionType = builder.objectRef<Permission>('ActionPermission').implement({
  fields: (t) => ({
    allowed: t.exposeBoolean('allowed'),
    reason: t.exposeString('reason', { nullable: true }),
    failingChecks: t.stringList({ nullable: true, resolve: (p) => p.failingChecks }),
  }),
})

/** The per-request service, or the one refusal every signed-out caller gets (scope.ts). */
export const signedIn = <T>(service: T | null): T => {
  if (service === null) throw unauthenticated()
  return service
}

export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)

export interface HistoryEntry {
  at: Date
  action: string
  by: string | null
  note: string | null
}

/** One state-history line, read from the activity log (LOGGING.md §6). */
export const HistoryEntryType = builder.objectRef<HistoryEntry>('HistoryEntry').implement({
  fields: (t) => ({
    at: t.string({ resolve: (h) => h.at.toISOString() }),
    action: t.exposeString('action'),
    by: t.exposeString('by', { nullable: true }),
    note: t.exposeString('note', { nullable: true }),
  }),
})

/** Drops what the client left unset, so a `.strict()` zod schema sees only what was sent. */
export const compact = (input: Record<string, unknown> | null | undefined): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined && value !== null))

export const permission = (p: { allowed: true } | { allowed: false; reason: string; failingChecks?: readonly string[] | undefined }): Permission =>
  p.allowed ? { allowed: true, reason: null, failingChecks: null } : { allowed: false, reason: p.reason, failingChecks: p.failingChecks ? [...p.failingChecks] : null }
