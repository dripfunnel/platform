import { GraphQLError } from 'graphql'
import type { StoreAddress } from '#db/scoped/storeInfo'
import { createStorefrontSettingsService, socialNetworks, storefrontSettingsAudit, type BrandView, type SeoRow, type SettingsResult, type SocialNetwork } from '#saas/storefrontSettings/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'
import type { registerStoreInfo } from './storeInfo'

// Storefront › Site settings and the "Your brand" step (PortalStorefront; FIRST-RELEASE §14): the Owner writes
// (`publish`), the Manager reads (`storefront.read`), Staff and suppliers have no Storefront (ACCESS §5.1).

const words: Record<Exclude<SettingsResult<unknown>, { ok: true }>['reason'], string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  INVALID_EMAIL: 'That doesn’t look like an email address.',
  INVALID_IMAGE: 'Use an image you uploaded to this store.',
  NOT_FOUND: 'That isn’t here any more.',
}

const answered = <T>(result: SettingsResult<T>): T => {
  if (result.ok) return result.value
  const facts = 'field' in result ? { field: result.field } : {}
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
}

/** The fields GraphQL sends as null when left out; the rules take them as absent. */
const present = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined))

export const registerStorefrontSettings = (builder: StoreBuilder, address: ReturnType<typeof registerStoreInfo>) => {
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createStorefrontSettingsService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const Social = builder.objectRef<Record<string, string>>('StorefrontSocialLinks').implement({
    // Each network's profile address, https on its own host; a handle is saved as its address.
    fields: (t) => Object.fromEntries(socialNetworks.map((n) => [n, t.string({ nullable: true, resolve: (s) => s[n] ?? null })])) as Record<SocialNetwork, ReturnType<typeof t.string>>,
  })
  const Brand = builder.objectRef<BrandView>('StorefrontBrand').implement({
    fields: (t) => ({
      // Store info's name, which the brand step also sets.
      shopName: t.exposeString('shop_name'),
      logoAssetId: t.exposeID('logo_asset_id', { nullable: true }),
      faviconAssetId: t.exposeID('favicon_asset_id', { nullable: true }),
      // Hints for the AI only (#rrggbb); never on the Shop API.
      primaryColour: t.exposeString('primary_colour', { nullable: true }),
      secondaryColour: t.exposeString('secondary_colour', { nullable: true }),
      tagline: t.exposeString('tagline', { nullable: true }),
      description: t.exposeString('description', { nullable: true }),
      social: t.field({ type: Social, resolve: (b) => b.social }),
      // Store info's until the brand is first saved.
      contactEmail: t.exposeString('contact_email', { nullable: true }),
      contactPhone: t.exposeString('contact_phone', { nullable: true }),
      contactAddress: t.field({ type: address.Address, resolve: (b) => b.contact_address }),
      voice: t.exposeString('voice', { nullable: true }),
      // The shop has a name and the brand a logo: "Continue to templates" and #318's template choice wait for it.
      brandReady: t.exposeBoolean('ready'),
    }),
  })
  const Seo = builder.objectRef<SeoRow>('StorefrontSeo').implement({
    fields: (t) => ({
      title: t.exposeString('title', { nullable: true }),
      description: t.exposeString('description', { nullable: true }),
      shareImageAssetId: t.exposeID('share_asset_id', { nullable: true }),
    }),
  })

  const SocialInput = builder.inputType('StorefrontSocialInput', {
    // A handle (@name, or a phone number for WhatsApp) or an https address on the network's own host.
    fields: (t) => Object.fromEntries(socialNetworks.map((n) => [n, t.string()])) as Record<SocialNetwork, ReturnType<typeof t.string>>,
  })
  const BrandInput = builder.inputType('StorefrontBrandInput', {
    fields: (t) => ({
      // Left out, Store info's name stays.
      shopName: t.string(),
      logoAssetId: t.id({ required: true }),
      faviconAssetId: t.id(),
      primaryColour: t.string(),
      secondaryColour: t.string(),
      tagline: t.string(),
      description: t.string(),
      social: t.field({ type: SocialInput }),
      contactEmail: t.string(),
      contactPhone: t.string(),
      contactAddress: t.field({ type: address.AddressInput }),
      // One of the portal's suggestions or the merchant's own words, up to 60 characters.
      voice: t.string(),
    }),
  })
  const SeoInput = builder.inputType('StorefrontSeoInput', {
    fields: (t) => ({ title: t.string(), description: t.string(), shareImageAssetId: t.id() }),
  })

  const read = { api: 'store', scope: 'store', permission: 'storefront.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store', permission: 'publish', target: 'none' } as const

  builder.queryFields((t) => ({
    storefrontBrand: t.field({ type: Brand, nullable: true, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).brand() }),
    storefrontSeo: t.field({ type: Seo, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).seo() }),
  }))

  builder.mutationFields((t) => ({
    // The whole section at once; a field left out is cleared.
    saveStorefrontBrand: t.field({
      type: Brand,
      args: { input: t.arg({ type: BrandInput, required: true }) },
      extensions: { access: { ...write, audit: storefrontSettingsAudit.brandChanged } },
      resolve: async (_, args, ctx) => {
        const { social, contactAddress, ...rest } = args.input
        const input = {
          ...present(rest),
          logoAssetId: String(args.input.logoAssetId),
          ...(args.input.faviconAssetId ? { faviconAssetId: String(args.input.faviconAssetId) } : {}),
          ...(social ? { social: present(social) } : {}),
          ...(contactAddress ? { contactAddress: present(contactAddress) as Partial<StoreAddress> } : {}),
        }
        return answered(await service(ctx).saveBrand(input))
      },
    }),
    // Saving re-renders the home page at once, using no allowance; nothing else waits for a publish (SAAS §9.2).
    saveStorefrontSeo: t.field({
      type: Seo,
      args: { input: t.arg({ type: SeoInput, required: true }) },
      extensions: { access: { ...write, audit: storefrontSettingsAudit.seoChanged } },
      resolve: async (_, args, ctx) => {
        const { shareImageAssetId, ...rest } = args.input
        return answered(await service(ctx).saveSeo({ ...present(rest), ...(shareImageAssetId ? { shareImageAssetId: String(shareImageAssetId) } : {}) }))
      },
    }),
  }))
}
