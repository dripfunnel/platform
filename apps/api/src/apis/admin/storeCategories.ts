import { GraphQLError } from 'graphql'
import { sectionKeys, storeCategoryAudit, type SampleDetail, type SampleProblem, type StaffCategory, type StoreCategoryResult } from '#saas/storeCategories/index'
import { builder } from './builder'
import { iso, signedIn } from './types'

// Store categories on the Admin API (admin FIRST-RELEASE §2, DATA-MODEL §7.2): every role reads, Super admin writes.

const Name = builder.objectRef<{ language: string; name: string }>('StoreCategoryName').implement({
  fields: (t) => ({ language: t.exposeString('language'), name: t.exposeString('name') }),
})

type Sample = NonNullable<StaffCategory['sample']>
const SampleCollection = builder.objectRef<Sample['collections'][number]>('StoreCategorySampleCollection').implement({
  fields: (t) => ({ name: t.exposeString('name'), products: t.int({ resolve: (c) => c.skus.length }) }),
})
// What a category's sample catalog holds (DATA-MODEL §7.2); its file is `storeCategorySampleFile`.
const SampleType = builder.objectRef<Sample>('StoreCategorySample').implement({
  fields: (t) => ({
    currency: t.exposeString('currency'),
    products: t.exposeInt('products'),
    collections: t.field({ type: [SampleCollection], resolve: (x) => x.collections }),
    photos: t.int({ resolve: (x) => Object.keys(x.photos).length }),
    uploadedAt: t.string({ resolve: (x) => x.uploaded_at.toISOString() }),
  }),
})

/** Where the console previews a sample photo (apis/admin/samplePhotos.ts). */
const previewUrlOf = (categoryId: string, sha: string | null) => (sha ? `/api/store-category-photos/${categoryId}/${sha}` : null)

type DetailProduct = SampleDetail['products'][number] & { categoryId: string }
const DetailPhoto = builder.objectRef<{ ref: string; previewUrl: string | null }>('StoreCategorySamplePhoto').implement({
  fields: (t) => ({ ref: t.exposeString('ref'), previewUrl: t.exposeString('previewUrl', { nullable: true }) }),
})
const DetailProductType = builder.objectRef<DetailProduct>('StoreCategorySampleProduct').implement({
  fields: (t) => ({
    handle: t.exposeString('handle'),
    name: t.exposeString('name'),
    description: t.exposeString('description'),
    sku: t.exposeString('sku'),
    price: t.exposeString('price'),
    stock: t.exposeInt('stock', { nullable: true }),
    visible: t.exposeBoolean('visible'),
    photos: t.field({ type: [DetailPhoto], resolve: (p) => p.photos.map((x) => ({ ref: x.ref, previewUrl: previewUrlOf(p.categoryId, x.previewSha) })) }),
    collections: t.exposeStringList('collections'),
  }),
})
type DetailCollection = SampleDetail['collections'][number] & { categoryId: string }
const DetailCollectionType = builder.objectRef<DetailCollection>('StoreCategorySampleCollectionDetail').implement({
  fields: (t) => ({
    name: t.exposeString('name'),
    products: t.exposeInt('products'),
    photo: t.field({ type: DetailPhoto, nullable: true, resolve: (c) => (c.photo ? { ref: c.photo, previewUrl: previewUrlOf(c.categoryId, c.previewSha) } : null) }),
  }),
})
const Detail = builder.objectRef<SampleDetail & { categoryId: string }>('StoreCategorySampleDetail').implement({
  fields: (t) => ({
    currency: t.exposeString('currency'),
    uploadedAt: t.string({ resolve: (d) => d.uploaded_at.toISOString() }),
    products: t.field({ type: [DetailProductType], resolve: (d) => d.products.map((p) => ({ ...p, categoryId: d.categoryId })) }),
    collections: t.field({ type: [DetailCollectionType], resolve: (d) => d.collections.map((c) => ({ ...c, categoryId: d.categoryId })) }),
  }),
})

const ItemInput = builder.inputType('StoreCategorySampleProductInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    description: t.string({ required: true }),
    sku: t.string({ required: true }),
    price: t.string({ required: true }),
    stock: t.int(),
    visible: t.boolean({ required: true }),
    photos: t.stringList(),
    collections: t.stringList({ required: true }),
  }),
})
const CollectionPhotoInput = builder.inputType('StoreCategorySampleCollectionPhotoInput', {
  fields: (t) => ({ name: t.string({ required: true }), photo: t.string({ required: true }) }),
})
const ItemsInput = builder.inputType('StoreCategorySampleInput', {
  fields: (t) => ({
    currency: t.string({ required: true }),
    products: t.field({ type: [ItemInput], required: true }),
    collections: t.stringList({ required: true }),
    collectionPhotos: t.field({ type: [CollectionPhotoInput] }),
  }),
})

// The category's starting template (DATA-MODEL §7.2), read-only: migrations set it.
const CategoryTemplate = builder.objectRef<{ key: string; name: string; tag: string }>('StoreCategoryTemplate').implement({
  fields: (t) => ({ key: t.exposeString('key'), name: t.exposeString('name'), tag: t.exposeString('tag') }),
})

const Category = builder.objectRef<StaffCategory>('StoreCategory').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    key: t.exposeString('key'),
    names: t.field({ type: [Name], resolve: (c) => Object.entries(c.names).map(([language, name]) => ({ language, name })) }),
    sections: t.exposeStringList('sections'),
    position: t.exposeInt('position'),
    archivedAt: t.string({ nullable: true, resolve: (c) => iso(c.archived_at) }),
    storeCount: t.exposeInt('store_count'),
    sample: t.field({ type: SampleType, nullable: true, resolve: (c) => c.sample }),
    hasDefaultSample: t.exposeBoolean('has_default_sample'),
    template: t.field({ type: CategoryTemplate, nullable: true, resolve: (c) => (c.template_key ? { key: c.template_key, name: c.template_name ?? c.template_key, tag: c.template_tag ?? '' } : null) }),
  }),
})

const NameInput = builder.inputType('StoreCategoryNameInput', {
  fields: (t) => ({ language: t.string({ required: true }), name: t.string({ required: true }) }),
})
const Section = builder.enumType('StoreCategorySection', { values: sectionKeys })
const CategoryInput = builder.inputType('StoreCategoryInput', {
  fields: (t) => ({
    names: t.field({ type: [NameInput], required: true }),
    sections: t.field({ type: [Section], required: true }),
  }),
})

const read = { access: { api: 'admin' as const, scope: 'platform' as const, permission: 'storeCategories.read' as const, target: 'none' as const } }
const manage = (audit: string) => ({ access: { api: 'admin' as const, scope: 'platform' as const, permission: 'storeCategories.manage' as const, target: 'none' as const, audit } })

const words = {
  INVALID_INPUT: 'Something here isn’t valid.',
  KEY_TAKEN: 'A category with that English name already exists.',
  NOT_FOUND: 'That category isn’t here any more.',
  TOO_MANY: 'There can be up to 100 store categories. Archive or reuse one instead.',
} as const

const Problem = builder.objectRef<SampleProblem>('StoreCategorySampleProblem').implement({
  fields: (t) => ({ line: t.exposeInt('line'), column: t.exposeString('column', { nullable: true }), code: t.exposeString('code'), message: t.exposeString('message') }),
})
// A file with problems is an answer, not an error: staff fix the lines it names and upload again.
const SampleSave = builder.objectRef<{ category: StaffCategory | null; problems: SampleProblem[] }>('StoreCategorySampleSave').implement({
  fields: (t) => ({
    category: t.field({ type: Category, nullable: true, resolve: (r) => r.category }),
    problems: t.field({ type: [Problem], resolve: (r) => r.problems }),
  }),
})

const answered = (result: StoreCategoryResult<StaffCategory>): StaffCategory => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

builder.queryFields((t) => ({
  storeCategories: t.field({
    type: [Category],
    extensions: read,
    resolve: async (_, __, ctx) => signedIn(ctx.storeCategories ?? null).list(),
  }),
  storeCategorySample: t.field({
    type: Detail,
    nullable: true,
    args: { categoryId: t.arg.id({ required: true }) },
    extensions: read,
    resolve: async (_, args, ctx) => {
      const id = String(args.categoryId)
      const detail = await signedIn(ctx.storeCategories ?? null).sampleDetail(id)
      return detail ? { ...detail, categoryId: id } : null
    },
  }),
}))

builder.mutationFields((t) => ({
  createStoreCategory: t.field({
    type: Category,
    args: { input: t.arg({ type: CategoryInput, required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(storeCategoryAudit.created),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.storeCategories ?? null).create(args.input, args.reason)),
  }),
  updateStoreCategory: t.field({
    type: Category,
    args: { id: t.arg.id({ required: true }), input: t.arg({ type: CategoryInput, required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(storeCategoryAudit.updated),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.storeCategories ?? null).update(String(args.id), args.input, args.reason)),
  }),
  // DripFunnel's built-in data for the category (0401), checked and its photos copied once (DATA-MODEL §7.2).
  addDefaultStoreCategorySample: t.field({
    type: SampleSave,
    args: { categoryId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(storeCategoryAudit.sampleSaved),
    resolve: async (_, args, ctx) => {
      const result = await signedIn(ctx.storeCategories ?? null).addDefaultSample(String(args.categoryId), args.reason)
      if (result.ok) return { category: result.value, problems: [] }
      if (result.reason === 'SAMPLE_INVALID') return { category: null, problems: 'problems' in result ? result.problems : [] }
      return { category: answered(result), problems: [] }
    },
  }),
  // The editor's Save (admin FIRST-RELEASE §11b): the items become the sample's file, checked as any sample is.
  saveStoreCategorySampleItems: t.field({
    type: SampleSave,
    args: { categoryId: t.arg.id({ required: true }), input: t.arg({ type: ItemsInput, required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(storeCategoryAudit.sampleSaved),
    resolve: async (_, args, ctx) => {
      const { products, collectionPhotos, ...rest } = args.input
      const input = { ...rest, products: products.map((p) => ({ ...p, stock: p.stock ?? null, photos: p.photos ?? [] })), collectionPhotos: collectionPhotos ?? [] }
      const result = await signedIn(ctx.storeCategories ?? null).saveSampleItems(String(args.categoryId), input, args.reason)
      if (result.ok) return { category: result.value, problems: [] }
      if (result.reason === 'SAMPLE_INVALID') return { category: null, problems: 'problems' in result ? result.problems : [] }
      return { category: answered(result), problems: [] }
    },
  }),
  removeStoreCategorySample: t.field({
    type: Category,
    args: { categoryId: t.arg.id({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(storeCategoryAudit.sampleRemoved),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.storeCategories ?? null).removeSample(String(args.categoryId), args.reason)),
  }),
  archiveStoreCategory: t.field({
    type: Category,
    args: { id: t.arg.id({ required: true }), archived: t.arg.boolean({ required: true }), reason: t.arg.string({ required: true }) },
    extensions: manage(storeCategoryAudit.archived),
    resolve: async (_, args, ctx) => answered(await signedIn(ctx.storeCategories ?? null).setArchived(String(args.id), args.archived, args.reason)),
  }),
}))
