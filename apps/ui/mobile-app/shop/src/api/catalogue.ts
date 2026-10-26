import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// The catalogue reads and the add-to-cart write of the Shop API (apps/api schema/shop.graphql). Every price, stock figure and
// availability is the API's: nothing here adds, rounds or compares an amount except to tell whether two are the same.

export const productsPerPage = 20

export type Price = { amount: string; currency: string }
export type Photo = { url: string; alt: string | null; versionId: string | null }
export type Badge = { label: string; tone: string | null }

export type ProductCard = {
  id: string
  slug: string
  name: string
  inStock: boolean
  price: Price | null
  compareAt: Price | null
  /** The product's versions are not all one price, so `price` is the lowest. */
  fromPrice: boolean
  photo: Photo | null
  badge: string | null
}

export type Collection = { id: string; slug: string; name: string; description: string | null; imageUrl: string | null }
export type FacetValue = { id: string; name: string; count: number }
export type Facet = { id: string; name: string; values: FacetValue[] }

/** A page of a list: what a screen shows, and the cursor of the next page. */
export type Page<Item> = { items: Item[]; next: string | null }
export type CollectionsPage = Page<Collection>
export type ProductsPage = Page<ProductCard> & { facets: Facet[]; collection: { name: string; description: string | null } | null }
export type Home = { collections: Collection[]; products: ProductCard[] }

export type ProductOption = { id: string; name: string; values: { id: string; name: string }[] }
export type ProductVersion = {
  id: string
  name: string | null
  inStock: boolean
  /** What is left; null when the store doesn't count it. */
  available: number | null
  price: Price | null
  compareAt: Price | null
  /** The value this version has for each option, by option id. */
  choices: Record<string, string>
}
export type Spec = { name: string; value: string; versionId: string | null }
export type SizeChart = { name: string | null; unit: string | null; measurements: string[]; rows: { size: string; values: string[] }[]; fitNotes: string | null; modelInfo: string | null }
export type StoryModule = { id: string; kind: string; title: string | null; body: string | null; photos: Photo[]; items: { title: string | null; text: string | null; photoUrl: string | null }[] }
export type ProductVideo = { fileUrl: string | null; pageUrl: string | null }

export type Product = {
  id: string
  slug: string
  name: string
  description: string | null
  inStock: boolean
  price: Price | null
  compareAt: Price | null
  fromPrice: boolean
  badge: string | null
  highlights: string[]
  options: ProductOption[]
  versions: ProductVersion[]
  photos: Photo[]
  video: ProductVideo | null
  specs: Spec[]
  faqs: { question: string; answer: string }[]
  returns: string | null
  warranty: string | null
  sizeChart: SizeChart | null
  story: StoryModule[]
  pricesIncludeTax: boolean
}

/** One call to the Shop API: what to send, how to read the answer, and the slot its answer is kept in for offline (null: never kept). */
export type Operation<T> = { slot: string | null; signature: string; query: string; variables: Record<string, unknown>; parse: (data: unknown) => T }

export const run = async <T>(client: ApiClient, operation: Operation<T>): Promise<T> => operation.parse(await client.request<unknown>(operation.query, operation.variables))

const operation = <T>(slot: string | null, query: string, variables: Record<string, unknown>, parse: (data: unknown) => T): Operation<T> => ({ slot, signature: JSON.stringify(variables), query, variables, parse })

const money = z.object({ amount: z.string(), currency: z.string() }).nullable()
const image = z.object({ url: z.string().nullable() }).nullable()
const list = <S extends z.ZodType>(item: S) => z.array(item).nullable().transform((value) => value ?? [])
const text = z.string().nullable()

/** A video's page link is opened in the browser, so only a web address is kept. */
const webUrl = (url: string | null): string | null => (url !== null && /^https?:\/\//i.test(url) ? url : null)

const photoSchema = z.object({ alt: text, versionId: text.optional(), image })
const toPhoto = (photo: z.infer<typeof photoSchema> | null): Photo | null => (photo?.image?.url ? { url: photo.image.url, alt: photo.alt, versionId: photo.versionId ?? null } : null)
const photos = (value: (z.infer<typeof photoSchema> | null)[]): Photo[] => value.flatMap((photo) => toPhoto(photo) ?? [])

const pageInfo = z.object({ endCursor: text, hasNextPage: z.boolean().nullable() }).nullable()
const nextOf = (info: z.infer<typeof pageInfo>): string | null => (info?.hasNextPage && info.endCursor ? info.endCursor : null)

const m = '{ amount currency }'
const summaryFields = `id slug name inStock price ${m} compareAt ${m} maxPrice ${m} photo { alt image { url } } badges { label tone }`

const summarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  inStock: z.boolean(),
  price: money,
  compareAt: money.optional(),
  maxPrice: money.optional(),
  photo: photoSchema.nullable(),
  badges: list(z.object({ label: z.string(), tone: text })),
})

const differs = (low: Price | null, high: Price | null | undefined): boolean => low !== null && high != null && low.amount !== high.amount

const cardOf = (product: z.infer<typeof summarySchema>): ProductCard => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  inStock: product.inStock,
  price: product.price,
  compareAt: product.compareAt ?? null,
  fromPrice: differs(product.price, product.maxPrice),
  photo: toPhoto(product.photo),
  badge: product.badges[0]?.label ?? null,
})

const collectionSchema = z.object({ id: z.string(), slug: z.string(), name: z.string(), description: text.optional(), image })
const toCollection = (c: z.infer<typeof collectionSchema>): Collection => ({ id: c.id, slug: c.slug, name: c.name, description: c.description ?? null, imageUrl: c.image?.url ?? null })

const collectionFields = 'id slug name description image { url }'

export const homeOperation = (): Operation<Home> =>
  operation(
    'home',
    `{ collections(first: 12) { nodes { ${collectionFields} } } products(first: 8, sort: NEWEST) { nodes { ${summaryFields} } } }`,
    {},
    (data) => {
      const answer = decode(z.object({ collections: z.object({ nodes: list(collectionSchema) }).nullable(), products: z.object({ nodes: list(summarySchema) }).nullable() }), data)
      return { collections: (answer.collections?.nodes ?? []).map(toCollection), products: (answer.products?.nodes ?? []).map(cardOf) }
    },
  )

export const collectionsOperation = (after: string | null): Operation<CollectionsPage> =>
  operation(
    after === null ? 'collections' : null,
    `query($after: String) { collections(first: 50, after: $after) { nodes { ${collectionFields} } pageInfo { endCursor hasNextPage } } }`,
    { after },
    (data) => {
      const { collections } = decode(z.object({ collections: z.object({ nodes: list(collectionSchema), pageInfo }).nullable() }), data)
      return { items: (collections?.nodes ?? []).map(toCollection), next: nextOf(collections?.pageInfo ?? null) }
    },
  )

export type ProductSort = 'NEWEST' | 'PRICE_LOW' | 'PRICE_HIGH'

export type ProductsRequest = { collection: string | null; filters: string[]; sort: ProductSort | null; after: string | null }

const facetSchema = z.object({ id: z.string(), name: z.string(), values: list(z.object({ id: z.string(), name: z.string(), count: z.number() })) })

// The first page of a collection also brings the collection's own words and the filters; later pages bring only products.
export const productsOperation = ({ collection, filters, sort, after }: ProductsRequest): Operation<ProductsPage> => {
  const first = after === null
  const query =
    'query($collection: String, $filters: [ID!], $sort: ShopProductSort, $after: String, $first: Int) {' +
    (first && collection !== null ? ' collection(slug: $collection) { name description }' : '') +
    ` products(collection: $collection, filters: $filters, sort: $sort, after: $after, first: $first) { nodes { ${summaryFields} } pageInfo { endCursor hasNextPage }${first ? ' facets { id name values { id name count } }' : ''} } }`
  const variables = { collection, filters: filters.length > 0 ? filters : null, sort, after, first: productsPerPage }
  const slot = first ? `products:${collection ?? '*'}` : null
  return operation(slot, query, variables, (data) => {
    const answer = decode(
      z.object({
        collection: z.object({ name: text, description: text }).nullable().optional(),
        products: z.object({ nodes: list(summarySchema), pageInfo, facets: list(facetSchema).optional() }).nullable(),
      }),
      data,
    )
    return {
      items: (answer.products?.nodes ?? []).map(cardOf),
      next: nextOf(answer.products?.pageInfo ?? null),
      facets: answer.products?.facets ?? [],
      collection: answer.collection?.name ? { name: answer.collection.name, description: answer.collection.description } : null,
    }
  })
}

export const searchOperation = (query: string, after: string | null, first: number = productsPerPage): Operation<Page<ProductCard>> =>
  operation(
    null,
    `query($query: String!, $after: String, $first: Int) { search(query: $query, after: $after, first: $first) { nodes { ${summaryFields} } pageInfo { endCursor hasNextPage } } }`,
    { query, after, first },
    (data) => {
      const { search } = decode(z.object({ search: z.object({ nodes: list(summarySchema), pageInfo }).nullable() }), data)
      return { items: (search?.nodes ?? []).map(cardOf), next: nextOf(search?.pageInfo ?? null) }
    },
  )

const storyPhoto = z.object({ alt: text, image }).nullable()
const storySchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: text,
  body: text,
  photo: storyPhoto,
  photos: list(storyPhoto),
  items: list(z.object({ title: text, text, photo: storyPhoto })),
  block: z.object({ title: text, body: text, photo: storyPhoto }).nullable(),
})

const productSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: text,
  inStock: z.boolean(),
  price: money,
  compareAt: money,
  maxPrice: money,
  badges: list(z.object({ label: z.string(), tone: text })),
  highlights: list(z.string()),
  options: list(z.object({ id: z.string(), name: z.string(), values: list(z.object({ id: z.string(), name: z.string() })) })),
  versions: list(
    z.object({ id: z.string(), name: text, inStock: z.boolean(), available: z.number().nullable(), price: money, compareAt: money, choices: list(z.object({ optionId: z.string(), valueId: z.string() })) }),
  ),
  photos: list(photoSchema),
  video: z.object({ url: text, file: image }).nullable(),
  specs: list(z.object({ name: z.string(), value: z.string(), versionId: text })),
  faqs: list(z.object({ question: z.string(), answer: z.string() })),
  returns: text,
  warranty: text,
  sizeChart: z
    .object({ name: text, unit: text, measurements: list(z.string()), rows: list(z.object({ size: z.string(), values: list(z.string()) })), fitNotes: text, modelInfo: text })
    .nullable(),
  story: list(storySchema),
})

const storyPhotoFields = 'alt image { url }'

export const productOperation = (slug: string): Operation<Product | null> =>
  operation(
    `product:${slug}`,
    `query($slug: String!) { store { pricesIncludeTax } product(slug: $slug) { id slug name description inStock price ${m} compareAt ${m} maxPrice ${m} badges { label tone } highlights options { id name values { id name } } versions { id name inStock available price ${m} compareAt ${m} choices { optionId valueId } } photos { alt versionId image { url } } video { url file { url } } specs { name value versionId } faqs { question answer } returns warranty sizeChart { name unit measurements rows { size values } fitNotes modelInfo } story { id kind title body photo { ${storyPhotoFields} } photos { ${storyPhotoFields} } items { title text photo { ${storyPhotoFields} } } block { title body photo { ${storyPhotoFields} } } } } }`,
    { slug },
    (data) => {
      const answer = decode(z.object({ store: z.object({ pricesIncludeTax: z.boolean().nullable() }).nullable(), product: productSchema.nullable() }), data)
      const p = answer.product
      if (!p) return null
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        inStock: p.inStock,
        price: p.price,
        compareAt: p.compareAt,
        fromPrice: differs(p.price, p.maxPrice),
        badge: p.badges[0]?.label ?? null,
        highlights: p.highlights,
        options: p.options,
        versions: p.versions.map((v) => ({ id: v.id, name: v.name, inStock: v.inStock, available: v.available, price: v.price, compareAt: v.compareAt, choices: Object.fromEntries(v.choices.map((c) => [c.optionId, c.valueId])) })),
        photos: photos(p.photos),
        video: p.video && (p.video.file?.url || webUrl(p.video.url)) ? { fileUrl: p.video.file?.url ?? null, pageUrl: webUrl(p.video.url) } : null,
        specs: p.specs,
        faqs: p.faqs,
        returns: p.returns,
        warranty: p.warranty,
        sizeChart: p.sizeChart && p.sizeChart.rows.length > 0 ? p.sizeChart : null,
        story: p.story.map((s) => ({
          id: s.id,
          kind: s.kind,
          title: s.title ?? s.block?.title ?? null,
          body: s.body ?? s.block?.body ?? null,
          photos: photos([s.photo ?? s.block?.photo ?? null, ...s.photos]),
          items: s.items.map((item) => ({ title: item.title, text: item.text, photoUrl: item.photo?.image?.url ?? null })),
        })),
        pricesIncludeTax: answer.store?.pricesIncludeTax ?? false,
      }
    },
  )

const cartChange = z.object({ addToCart: z.object({ cartToken: text }).nullable() })

/** Adds one version to the cart; answers the guest's cart token, null for a signed-in shopper. */
export const addToCart = async (client: ApiClient, versionId: string, quantity: number): Promise<string | null> =>
  decode(cartChange, await client.request<unknown>('mutation($versionId: ID!, $quantity: Int!) { addToCart(versionId: $versionId, quantity: $quantity) { cartToken } }', { versionId, quantity })).addToCart?.cartToken ?? null
