import { googleSignInAudit, type GoogleSignInService } from '#saas/googleSignIn/index'
import { builder } from './builder'
import { signedIn } from './fields'

// Settings › Integrations, Google sign-in on the Platform API (#1046). Thin: saas/googleSignIn decides.
type Status = Awaited<ReturnType<GoogleSignInService['status']>>
const writes = { api: 'platform', scope: 'partner', permission: 'integrations.write', target: 'none' } as const

const StatusType = builder.objectRef<Status>('PartnerGoogleSignIn').implement({
  fields: (t) => ({
    enabled: t.exposeBoolean('enabled'),
    clientId: t.string({ nullable: true, resolve: (s) => s.clientId }),
    secretHint: t.string({ nullable: true, resolve: (s) => s.secretHint }),
    setBy: t.string({ nullable: true, resolve: (s) => s.setBy }),
    setAt: t.string({ nullable: true, resolve: (s) => s.setAt?.toISOString() ?? null }),
    redirectUri: t.string({ nullable: true, resolve: (s) => s.redirectUri }),
  }),
})

type Outcome = { ok: boolean; reason?: string }
const OutcomeType = builder.objectRef<Outcome>('PartnerGoogleSignInResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
  }),
})

builder.queryFields((t) => ({
  partnerGoogleSignIn: t.field({ type: StatusType, extensions: { access: writes }, resolve: (_, __, ctx) => signedIn(ctx.googleSignIn).status() }),
}))

builder.mutationFields((t) => ({
  savePartnerGoogleSignIn: t.field({
    type: OutcomeType,
    args: { clientId: t.arg.string({ required: true }), clientSecret: t.arg.string({ required: true }) },
    extensions: { access: { ...writes, audit: googleSignInAudit.save, blockedFor: ['impersonation'] } },
    resolve: (_, args, ctx) => signedIn(ctx.googleSignIn).save(args),
  }),
  turnOffPartnerGoogleSignIn: t.field({
    type: OutcomeType,
    extensions: { access: { ...writes, audit: googleSignInAudit.turnOff, blockedFor: ['impersonation'] } },
    resolve: (_, __, ctx) => signedIn(ctx.googleSignIn).turnOff(),
  }),
}))
