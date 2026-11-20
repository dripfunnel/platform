import { mapsAudit, type PartnerMapsService } from '#saas/partnerCredentials/index'
import { builder } from './builder'
import { signedIn } from './fields'

// Settings › Integrations, Google Maps on the Platform API (#1612; #1614 draws the panel). Thin: saas/partnerCredentials decides.
// The key goes in once and comes back as "AIza…abcd".
type Maps = Awaited<ReturnType<PartnerMapsService['account']>>
type Key = NonNullable<Maps['key']>
// Every Maps field is the partner's or a setup session's, never an impersonation's (ACCESS §8.1), the read included.
const access = { api: 'platform', scope: 'partner', permission: 'integrations.write', target: 'none', blockedFor: ['impersonation'] } as const

const KeyType = builder.objectRef<Key>('PartnerMapsKey').implement({
  fields: (t) => ({
    hint: t.exposeString('hint'),
    status: t.exposeString('status'),
    lastTestedAt: t.string({ nullable: true, resolve: (k) => k.lastTestedAt?.toISOString() ?? null }),
  }),
})

const MapsType = builder.objectRef<Maps>('PartnerMaps').implement({
  fields: (t) => ({
    key: t.field({ type: KeyType, nullable: true, resolve: (m) => m.key }),
    // Whether DripFunnel's key is there for the partner: Super admin turned it on, Admin let the partner use it, and it is Working; never the key.
    dripfunnel: t.exposeBoolean('dripfunnel'),
    // The partner's choice, `own` or `dripfunnel`; null leaves it to its own key, if it has one.
    choice: t.string({ nullable: true, resolve: (m) => m.choice }),
    // Whose key the stores' maps use now, `own` or `dripfunnel`; null where none is usable, so no map is drawn.
    sender: t.string({ nullable: true, resolve: (m) => m.sender }),
  }),
})

type Outcome = { ok: boolean; reason?: string; status?: string; problem?: string }
const OutcomeType = builder.objectRef<Outcome>('PartnerMapsResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (o) => o.reason ?? null }),
    status: t.string({ nullable: true, resolve: (o) => o.status ?? null }),
    // What Google refused: invalid, geocoding_disabled, restricted or other.
    problem: t.string({ nullable: true, resolve: (o) => o.problem ?? null }),
  }),
})

builder.queryFields((t) => ({
  mapsKey: t.field({ type: MapsType, extensions: { access }, resolve: (_, __, ctx) => signedIn(ctx.maps).account() }),
}))

builder.mutationFields((t) => ({
  saveMapsKey: t.field({
    type: OutcomeType,
    args: { key: t.arg.string({ required: true }) },
    extensions: { access: { ...access, audit: mapsAudit.save } },
    resolve: (_, args, ctx) => signedIn(ctx.maps).save(args),
  }),
  testMapsKey: t.field({
    type: OutcomeType,
    extensions: { access: { ...access, audit: mapsAudit.test } },
    resolve: (_, __, ctx) => signedIn(ctx.maps).test(),
  }),
  removeMapsKey: t.field({
    type: OutcomeType,
    extensions: { access: { ...access, audit: mapsAudit.remove } },
    resolve: (_, __, ctx) => signedIn(ctx.maps).remove(),
  }),
  setMapsChoice: t.field({
    type: OutcomeType,
    args: { account: t.arg.string({ required: true }) },
    extensions: { access: { ...access, audit: mapsAudit.chosen } },
    resolve: (_, { account }, ctx) => signedIn(ctx.maps).setChoice(account),
  }),
}))
