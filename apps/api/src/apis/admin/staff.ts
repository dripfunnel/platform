import { GraphQLError } from 'graphql'
import { staffAudit, type StaffMemberDto, type StaffMembersService } from '#saas/staffMembers/index'
import { builder } from './builder'
import { iso, PageInfoType, PermissionType, signedIn } from './types'

// Staff on the Admin API (ui/admin/FIRST-RELEASE.md §10, §12; card #39): Super admin only. No
// field carries an invitation's link or token; those exist only in the invitee's email.

type Page = NonNullable<Awaited<ReturnType<StaffMembersService['staffList']>>>
type Permission = { allowed: boolean; reason?: string }

const Invitation = builder.objectRef<NonNullable<StaffMemberDto['invitation']>>('StaffInvitation').implement({
  fields: (t) => ({
    sentAt: t.string({ resolve: (i) => i.sentAt.toISOString() }),
    expiresAt: t.string({ resolve: (i) => i.expiresAt.toISOString() }),
    expired: t.exposeBoolean('expired'),
  }),
})

const permissionOf = (p: Permission | undefined) => (p ? { allowed: p.allowed, reason: p.reason ?? null, failingChecks: null } : null)

const Actions = builder.objectRef<StaffMemberDto['actions']>('StaffActions').implement({
  fields: (t) => ({
    changeRole: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.changeRole) }),
    remove: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf(a.remove) }),
    resend: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf('resend' in a ? a.resend : undefined) }),
    revoke: t.field({ type: PermissionType, nullable: true, resolve: (a) => permissionOf('revoke' in a ? a.revoke : undefined) }),
  }),
})

const Member = builder.objectRef<StaffMemberDto>('StaffMember').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name', { nullable: true }),
    email: t.exposeString('email'),
    role: t.exposeString('role'),
    lastSignInAt: t.string({ nullable: true, resolve: (m) => iso(m.lastSignInAt) }),
    twoFactor: t.exposeString('twoFactor'),
    invitation: t.field({ type: Invitation, nullable: true, resolve: (m) => m.invitation }),
    actions: t.field({ type: Actions, resolve: (m) => m.actions }),
  }),
})

const PageType = builder.objectRef<Page>('StaffPage').implement({
  fields: (t) => ({
    items: t.field({ type: [Member], resolve: (p) => p.items }),
    pageInfo: t.field({ type: PageInfoType, resolve: (p) => p.pageInfo }),
    soleSuperAdmin: t.exposeBoolean('soleSuperAdmin'),
  }),
})

const Result = builder.objectRef<{ ok: boolean; reason?: string }>('StaffResult').implement({
  fields: (t) => ({ ok: t.exposeBoolean('ok'), reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }) }),
})

const manage = (audit?: string) => ({ access: { api: 'admin' as const, scope: 'platform' as const, permission: 'staff.manage' as const, target: 'none' as const, ...(audit ? { audit } : {}) } })

builder.queryFields((t) => ({
  staff: t.field({
    type: PageType,
    args: { after: t.arg.string(), before: t.arg.string(), first: t.arg.int() },
    extensions: manage(),
    resolve: async (_, { after, before, first }, ctx) =>
      (await signedIn(ctx.staffMembers).staffList({ after, before, first })) ?? Promise.reject(new GraphQLError('That page link does not work.', { extensions: { code: 'INVALID_INPUT' } })),
  }),
}))

builder.mutationFields((t) => ({
  inviteStaff: t.field({
    type: Result,
    args: { email: t.arg.string({ required: true }), role: t.arg.string({ required: true }) },
    extensions: manage(staffAudit.inviteStaff),
    resolve: (_, { email, role }, ctx) => signedIn(ctx.staffMembers).inviteStaff(email, role),
  }),
  changeStaffRole: t.field({
    type: Result,
    args: { id: t.arg.id({ required: true }), role: t.arg.string({ required: true }) },
    extensions: manage(staffAudit.changeStaffRole),
    resolve: (_, { id, role }, ctx) => signedIn(ctx.staffMembers).changeStaffRole(String(id), role),
  }),
  removeStaff: t.field({ type: Result, args: { id: t.arg.id({ required: true }) }, extensions: manage(staffAudit.removeStaff), resolve: (_, { id }, ctx) => signedIn(ctx.staffMembers).removeStaff(String(id)) }),
  resendStaffInvite: t.field({ type: Result, args: { id: t.arg.id({ required: true }) }, extensions: manage(staffAudit.resendStaffInvite), resolve: (_, { id }, ctx) => signedIn(ctx.staffMembers).resendStaffInvite(String(id)) }),
  revokeStaffInvite: t.field({ type: Result, args: { id: t.arg.id({ required: true }) }, extensions: manage(staffAudit.revokeStaffInvite), resolve: (_, { id }, ctx) => signedIn(ctx.staffMembers).revokeStaffInvite(String(id)) }),
}))
