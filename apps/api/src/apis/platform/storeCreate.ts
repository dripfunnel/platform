import { createAudit, type CreatePermission, type PartnerStoresService } from '#saas/partnerStores/index'
import { builder } from './builder'
import { partnerRead, signedIn } from './fields'
import { MoneyType } from './money'

// Creating a store (ui/platform/FIRST-RELEASE.md §6.2, §16; card #221). Thin: saas/partnerStores
// decides every refusal.

type Form = Awaited<ReturnType<PartnerStoresService['createStoreForm']>>
type Progress = NonNullable<Awaited<ReturnType<PartnerStoresService['provisioning']>>>

export const CreatePermissionType = builder.objectRef<CreatePermission>('StoreCreatePermission').implement({
  fields: (t) => ({ allowed: t.exposeBoolean('allowed'), reason: t.string({ nullable: true, resolve: (p) => (p.allowed ? null : p.reason) }) }),
})

const Country = builder.objectRef<Form['countries'][number]>('StoreCountry').implement({
  fields: (t) => ({ code: t.exposeString('code'), name: t.exposeString('name'), currency: t.exposeString('currency') }),
})

const FormPlan = builder.objectRef<Form['plans'][number]>('StoreCreatePlan').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    trialDays: t.exposeInt('trialDays'),
    prices: t.field({ type: [MoneyType], resolve: (p) => p.prices }),
  }),
})

const FormType = builder.objectRef<Form>('CreateStoreForm').implement({
  fields: (t) => ({
    permission: t.field({ type: CreatePermissionType, resolve: (f) => f.permission }),
    countries: t.field({ type: [Country], resolve: (f) => f.countries }),
    plans: t.field({ type: [FormPlan], resolve: (f) => f.plans }),
    trials: t.exposeIntList('trials'),
    billingMode: t.exposeString('billingMode'),
  }),
})

const Step = builder.objectRef<Progress['steps'][number]>('ProvisioningStep').implement({
  fields: (t) => ({ key: t.exposeString('key'), state: t.exposeString('state') }),
})

const ProgressType = builder.objectRef<Progress>('ProvisioningProgress').implement({
  fields: (t) => ({ steps: t.field({ type: [Step], resolve: (p) => p.steps }), done: t.exposeBoolean('done'), elapsedSeconds: t.exposeInt('elapsedSeconds') }),
})

const Created = builder.objectRef<{ ok: boolean; storeId?: string; reason?: string; field?: string }>('CreateStoreResult').implement({
  fields: (t) => ({
    ok: t.exposeBoolean('ok'),
    storeId: t.string({ nullable: true, resolve: (r) => r.storeId ?? null }),
    reason: t.string({ nullable: true, resolve: (r) => r.reason ?? null }),
    field: t.string({ nullable: true, resolve: (r) => r.field ?? null }),
  }),
})

const CreateInput = builder.inputType('CreateStoreInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    ownerName: t.string({ required: true }),
    ownerEmail: t.string({ required: true }),
    country: t.string({ required: true }),
    planId: t.id({ required: true }),
    trialDays: t.int({ required: true }),
  }),
})

builder.queryFields((t) => ({
  createStoreForm: t.field({ type: FormType, extensions: { access: partnerRead }, resolve: (_, __, ctx) => signedIn(ctx.stores).createStoreForm() }),
  provisioning: t.field({
    type: ProgressType,
    nullable: true,
    args: { storeId: t.arg.id({ required: true }) },
    extensions: { access: partnerRead },
    resolve: (_, { storeId }, ctx) => signedIn(ctx.stores).provisioning(String(storeId)),
  }),
}))

builder.mutationFields((t) => ({
  createStore: t.field({
    type: Created,
    args: { input: t.arg({ type: CreateInput, required: true }) },
    extensions: { access: { api: 'platform', scope: 'partner', permission: 'stores.create', target: 'none', audit: createAudit } },
    resolve: (_, { input }, ctx) => signedIn(ctx.stores).createStore({ ...input, planId: String(input.planId) }),
  }),
}))
