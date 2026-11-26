import { GraphQLError } from 'graphql'
import { templateAudit, type PreviewRefusal, type StaffTemplate } from '#saas/storefrontTemplates/index'
import { builder } from './builder'
import { signedIn } from './types'

// Storefront templates on the Admin API (admin FIRST-RELEASE §11d): every role reads them and opens a ready preview;
// only a Super admin's first Preview makes a template's demo store.

const CategoryName = builder.objectRef<{ language: string; name: string }>('StorefrontTemplateCategoryName').implement({
  fields: (t) => ({ language: t.exposeString('language'), name: t.exposeString('name') }),
})
const Category = builder.objectRef<StaffTemplate['categories'][number]>('StorefrontTemplateCategory').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    key: t.exposeString('key'),
    names: t.field({ type: [CategoryName], resolve: (c) => Object.entries(c.names).map(([language, name]) => ({ language, name })) }),
  }),
})

const Template = builder.objectRef<StaffTemplate>('StorefrontTemplate').implement({
  fields: (t) => ({
    key: t.exposeString('key'),
    name: t.exposeString('name'),
    tag: t.exposeString('tag'),
    description: t.exposeString('description'),
    state: t.exposeString('state'),
    categories: t.field({ type: [Category], resolve: (x) => x.categories }),
    storeCount: t.exposeInt('store_count'),
    demo: t.exposeString('demo'),
  }),
})

const Preview = builder.objectRef<{ demo: string; url: string | null }>('TemplatePreview').implement({
  fields: (t) => ({ demo: t.exposeString('demo'), url: t.exposeString('url', { nullable: true }) }),
})

const words: Record<PreviewRefusal, string> = {
  NOT_FOUND: 'That template has no preview.',
  NO_DEMO: 'This template’s preview isn’t set up yet. A Super admin sets it up by opening it once.',
  NO_SAMPLE: 'Its store category has no sample catalog yet. Add one on Store categories first.',
  NO_HOUSE_PARTNER: 'DripFunnel’s own partner isn’t set up here, so there is nowhere to keep the demo store.',
  PREVIEW_OFF: 'Demos aren’t switched on here (SHOP_DOMAIN).',
}

const read = { access: { api: 'admin' as const, scope: 'platform' as const, permission: 'storeCategories.read' as const, target: 'none' as const } }

builder.queryFields((t) => ({
  storefrontTemplates: t.field({ type: [Template], extensions: read, resolve: (_, __, ctx) => signedIn(ctx.templates ?? null).list() }),
}))

builder.mutationFields((t) => ({
  // A mutation since it records who opened a preview, and a Super admin's first one makes the demo store.
  templatePreviewLink: t.field({
    type: Preview,
    args: { key: t.arg.string({ required: true }) },
    extensions: { access: { ...read.access, audit: templateAudit.previewOpened } },
    resolve: async (_, args, ctx) => {
      const result = await signedIn(ctx.templates ?? null).previewLink(args.key)
      if (result.ok) return result
      throw new GraphQLError(words[result.code], { extensions: { code: result.code } })
    },
  }),
}))
