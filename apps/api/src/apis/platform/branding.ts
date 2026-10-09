import { brandingAudit, type BrandingDto, type BrandingInput, type PublishResult } from '#saas/partnerBranding/index'
import type { ContrastReport } from '#saas/partnerBranding/index'
import { builder } from './builder'
import { partnerRead, signedIn } from './fields'

// Branding on the Platform API (ui/platform/FIRST-RELEASE.md §8; card #162). Thin: saas/partnerBranding
// decides, and the scope is always the session's partner.

const Files = builder.objectRef<BrandingInput['look']['files']>('BrandFiles').implement({
  fields: (t) => ({
    logoLight: t.exposeString('logoLight'),
    logoDark: t.exposeString('logoDark'),
    mark: t.exposeString('mark'),
    favicon: t.exposeString('favicon'),
    appIcon: t.exposeString('appIcon'),
    appIconForeground: t.exposeString('appIconForeground'),
    splash: t.exposeString('splash'),
  }),
})

const Look = builder.objectRef<BrandingInput['look']>('BrandLook').implement({
  fields: (t) => ({
    productName: t.exposeString('productName'),
    primary: t.exposeString('primary'),
    accent: t.exposeString('accent'),
    font: t.exposeString('font'),
    corner: t.exposeString('corner'),
    background: t.exposeString('background'),
    files: t.field({ type: Files, resolve: (l) => l.files }),
  }),
})

const Words = builder.objectRef<BrandingInput['words']>('BrandWords').implement({
  fields: (t) => ({
    supportEmail: t.exposeString('supportEmail'),
    supportUrl: t.exposeString('supportUrl'),
    helpUrl: t.exposeString('helpUrl'),
    termsUrl: t.exposeString('termsUrl'),
    privacyUrl: t.exposeString('privacyUrl'),
    dpaUrl: t.exposeString('dpaUrl'),
    impressum: t.exposeString('impressum'),
    poweredBy: t.exposeBoolean('poweredBy'),
  }),
})

const Pair = builder.objectRef<ContrastReport['pairs'][number]>('ContrastPair').implement({
  fields: (t) => ({ key: t.exposeString('key'), ratio: t.exposeString('ratio'), passes: t.exposeBoolean('passes') }),
})

const Contrast = builder.objectRef<ContrastReport>('ContrastReport').implement({
  fields: (t) => ({ pairs: t.field({ type: [Pair], resolve: (c) => c.pairs }), passes: t.exposeBoolean('passes'), fix: t.exposeString('fix', { nullable: true }) }),
})

const Permission = builder.objectRef<BrandingDto['permission']>('BrandingPermission').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), reason: t.string({ nullable: true, resolve: (p) => (p.allowed ? null : p.reason) }) }),
})

const BrandingType = builder.objectRef<BrandingDto>('Branding').implement({
  fields: (t) => ({
    look: t.field({ type: Look, resolve: (b) => b.look }),
    words: t.field({ type: Words, resolve: (b) => b.words }),
    published: t.exposeBoolean('published'),
    affects: t.exposeInt('affects'),
    contrast: t.field({ type: Contrast, resolve: (b) => b.contrast }),
    poweredByRule: t.exposeString('poweredByRule'),
    impressumRequired: t.exposeBoolean('impressumRequired'),
    dpaRequired: t.exposeBoolean('dpaRequired'),
    permission: t.field({ type: Permission, resolve: (b) => b.permission }),
  }),
})

const Result = builder.objectRef<PublishResult>('PublishBrandingResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    reason: t.string({ nullable: true, resolve: (r) => (r.ok ? null : r.reason) }),
    field: t.string({ nullable: true, resolve: (r) => (r.ok ? null : (r.field ?? null)) }),
    fix: t.string({ nullable: true, resolve: (r) => (r.ok ? null : (r.fix ?? null)) }),
    publishedAt: t.string({ nullable: true, resolve: (r) => (r.ok ? r.publishedAt.toISOString() : null) }),
  }),
})

const FilesInput = builder.inputType('BrandFilesInput', {
  fields: (t) => ({
    logoLight: t.string({ required: true }),
    logoDark: t.string({ required: true }),
    mark: t.string({ required: true }),
    favicon: t.string({ required: true }),
    // Defaulted, so a console from before #495 can still publish while the two deploy.
    appIcon: t.string({ required: true, defaultValue: '' }),
    appIconForeground: t.string({ required: true, defaultValue: '' }),
    splash: t.string({ required: true, defaultValue: '' }),
  }),
})
const LookInput = builder.inputType('BrandLookInput', {
  fields: (t) => ({
    productName: t.string({ required: true }),
    primary: t.string({ required: true }),
    accent: t.string({ required: true }),
    font: t.string({ required: true }),
    corner: t.string({ required: true }),
    background: t.string({ required: true }),
    files: t.field({ type: FilesInput, required: true }),
  }),
})
const WordsInput = builder.inputType('BrandWordsInput', {
  fields: (t) => ({
    supportEmail: t.string({ required: true }),
    supportUrl: t.string({ required: true }),
    helpUrl: t.string({ required: true }),
    termsUrl: t.string({ required: true }),
    privacyUrl: t.string({ required: true }),
    dpaUrl: t.string({ required: true }),
    impressum: t.string({ required: true }),
    poweredBy: t.boolean({ required: true }),
  }),
})
const BrandingInputType = builder.inputType('BrandingInput', {
  fields: (t) => ({ look: t.field({ type: LookInput, required: true }), words: t.field({ type: WordsInput, required: true }) }),
})


builder.queryFields((t) => ({
  branding: t.field({ type: BrandingType, nullable: true, extensions: { access: partnerRead }, resolve: (_, __, ctx) => signedIn(ctx.branding).branding() }),
  checkContrast: t.field({
    type: Contrast,
    nullable: true,
    args: { primary: t.arg.string({ required: true }), accent: t.arg.string({ required: true }) },
    extensions: { access: partnerRead },
    resolve: (_, { primary, accent }, ctx) => signedIn(ctx.branding).checkContrast(primary, accent),
  }),
}))

builder.mutationFields((t) => ({
  publishBranding: t.field({
    type: Result,
    args: { input: t.arg({ type: BrandingInputType, required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'branding.write', target: 'none', audit: brandingAudit.publishBranding } },
    resolve: (_, { input }, ctx) => signedIn(ctx.branding).publishBranding(input),
  }),
}))
