import { profileAudit, type ProfileResult } from '#saas/partnerProfile/index'
import { builder } from './builder'
import { signedIn } from './fields'

// My profile on the Platform API (#1053). Every role edits its own; a staff session edits none (ACCESS.md §8.1, §8.2).
const own = { api: 'platform', scope: 'session', permission: null, blockedFor: ['impersonation', 'setup'] } as const

const ResultType = builder.objectRef<ProfileResult>('MyProfileResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => (r.ok ? null : r.reason) }),
    triesLeft: t.int({ nullable: true, resolve: (r) => (!r.ok && r.reason === 'WRONG_PASSWORD' ? r.triesLeft : null) }),
    minutes: t.int({ nullable: true, resolve: (r) => (!r.ok && r.reason === 'LOCKED' ? r.minutes : null) }),
  }),
})

builder.mutationFields((t) => ({
  updateMyName: t.field({
    type: ResultType,
    args: { name: t.arg.string({ required: true }) },
    extensions: { access: { ...own, audit: profileAudit.name } },
    resolve: (_, { name }, ctx) => signedIn(ctx.profile).updateName(name),
  }),
  changeMyPassword: t.field({
    type: ResultType,
    args: { current: t.arg.string({ required: true }), password: t.arg.string({ required: true }) },
    extensions: { access: { ...own, audit: profileAudit.password } },
    resolve: (_, { current, password }, ctx) => signedIn(ctx.profile).changePassword(current, password),
  }),
}))
