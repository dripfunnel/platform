import type { PageInfo } from '#saas/activity/index'
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

export const permission = (p: { allowed: true } | { allowed: false; reason: string; failingChecks?: readonly string[] | undefined }): Permission =>
  p.allowed ? { allowed: true, reason: null, failingChecks: null } : { allowed: false, reason: p.reason, failingChecks: p.failingChecks ? [...p.failingChecks] : null }
