import { z } from 'zod'
import { logEvent } from '#core/log'
import { ShopUnauthorized, ShopUnavailable, type ShopGateway, type ShopProduct } from '#engine/modules/catalog/index'

// Shopify's OAuth and Admin GraphQL API for "Connect Shopify" (CATALOG K7): the store owner approves our app on
// their shop, and we read its products and their counts, nothing else (read_products, read_inventory).

export const shopifyScopes = 'read_products,read_inventory'
const apiVersion = '2025-07'
const timeoutMs = 8_000

/** The engine's gateway (catalog/shopify.ts), and the callback's two steps (hooks/shopify.ts). */
export interface ShopifyApi extends ShopGateway {
  /** Shopify's signature on the callback's query (its `hmac`), and that it came within the last hour. */
  verifyCallback: (query: URLSearchParams, now: Date) => Promise<boolean>
  exchange: (shop: string, code: string) => Promise<string>
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

const sameText = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const gramsOf = (weight: { unit: string; value: number } | null | undefined): number | null => {
  if (!weight) return null
  const per: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.349523125, POUNDS: 453.59237 }
  const factor = per[weight.unit]
  return factor === undefined ? null : Math.round(weight.value * factor)
}

// One more than an import takes (100 versions, 20 photos), so a product over either is reported, never cut short unseen.
const productFields = `
  id handle title descriptionHtml status
  options { name position }
  media(first: 21) { nodes { ... on MediaImage { image { url altText } } } }
  variants(first: 101) { nodes { sku barcode price compareAtPrice inventoryQuantity selectedOptions { name value }
    inventoryItem { unitCost { amount } measurement { weight { unit value } } } } }`

const productSchema = z
  .object({
    id: z.string(),
    handle: z.string(),
    title: z.string(),
    descriptionHtml: z.string().nullable(),
    status: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED']),
    options: z.array(z.object({ name: z.string(), position: z.number() }).loose()),
    media: z.object({ nodes: z.array(z.object({ image: z.object({ url: z.string(), altText: z.string().nullable() }).loose().optional() }).loose()) }).loose(),
    variants: z
      .object({
        nodes: z.array(
          z
            .object({
              sku: z.string().nullable(),
              barcode: z.string().nullable(),
              price: z.string().nullable(),
              compareAtPrice: z.string().nullable(),
              inventoryQuantity: z.number().nullable(),
              selectedOptions: z.array(z.object({ name: z.string(), value: z.string() }).loose()),
              inventoryItem: z
                .object({
                  unitCost: z.object({ amount: z.string() }).loose().nullable(),
                  measurement: z.object({ weight: z.object({ unit: z.string(), value: z.number() }).loose().nullable() }).loose().nullable(),
                })
                .loose()
                .nullable(),
            })
            .loose(),
        ),
      })
      .loose(),
  })
  .loose()

const normalised = (p: z.infer<typeof productSchema>): ShopProduct => {
  const options = [...p.options].sort((a, b) => a.position - b.position).map((o) => o.name)
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml ?? '',
    status: p.status,
    options,
    images: p.media.nodes.flatMap((m) => (m.image ? [{ url: m.image.url, alt: m.image.altText }] : [])),
    variants: p.variants.nodes.map((v) => ({
      sku: v.sku || null,
      barcode: v.barcode || null,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      cost: v.inventoryItem?.unitCost?.amount ?? null,
      grams: gramsOf(v.inventoryItem?.measurement?.weight),
      quantity: v.inventoryQuantity,
      values: options.map((name) => v.selectedOptions.find((s) => s.name === name)?.value ?? ''),
    })),
  }
}

const pageSchema = z.object({
  data: z
    .object({
      products: z.object({ nodes: z.array(productSchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }).loose() }).loose().optional(),
      nodes: z.array(productSchema.nullable()).optional(),
    })
    .loose()
    .optional(),
})

export const shopifyApi = (credentials: { clientId: string; clientSecret: string }, fetchImpl: typeof fetch = fetch): ShopifyApi => {
  const key = crypto.subtle.importKey('raw', new TextEncoder().encode(credentials.clientSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

  const call = async (url: string, init: RequestInit): Promise<unknown> => {
    let response: Response
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      throw new ShopUnavailable('shopify: no answer')
    }
    if (response.status === 401 || response.status === 403) throw new ShopUnauthorized('shopify: token refused')
    if (!response.ok) throw new ShopUnavailable(`shopify: answered ${response.status}`)
    return response.json()
  }

  return {
    authorizeUrl: (shop, state, redirectUri) => {
      const url = new URL(`https://${shop}/admin/oauth/authorize`)
      url.searchParams.set('client_id', credentials.clientId)
      url.searchParams.set('scope', shopifyScopes)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      return url.toString()
    },
    verifyCallback: async (query, now) => {
      const given = query.get('hmac') ?? ''
      const timestamp = Number(query.get('timestamp') ?? 0)
      if (!Number.isFinite(timestamp) || Math.abs(now.getTime() / 1000 - timestamp) > 3600) return false
      const message = [...query.entries()]
        .filter(([name]) => name !== 'hmac' && name !== 'signature')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, value]) => `${name}=${value}`)
        .join('&')
      return sameText(hex(await crypto.subtle.sign('HMAC', await key, new TextEncoder().encode(message))), given)
    },
    exchange: async (shop, code) => {
      const answer = z
        .object({ access_token: z.string().min(1) })
        .loose()
        .safeParse(await call(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code }) }))
      if (!answer.success) throw new ShopUnavailable('shopify: no token in the answer')
      return answer.data.access_token
    },
    products: async (shop, token, page) => {
      const byIds = page.ids && page.ids.length > 0
      const query = byIds
        ? `query P($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${productFields} } } }`
        : `query P($first: Int!, $after: String, $query: String) { products(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) { nodes { ${productFields} } pageInfo { hasNextPage endCursor } } }`
      const variables = byIds ? { ids: page.ids } : { first: page.first, after: page.after, query: page.search ? `title:*${page.search.replace(/[\\"*:]/g, '')}*` : null }
      const parsed = pageSchema.safeParse(
        await call(`https://${shop}/admin/api/${apiVersion}/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': token }, body: JSON.stringify({ query, variables }) }),
      )
      if (!parsed.success || !parsed.data.data) throw new ShopUnavailable('shopify: an answer we do not read')
      const { products, nodes } = parsed.data.data
      if (byIds) return { products: (nodes ?? []).flatMap((n) => (n ? [normalised(n)] : [])), next: null }
      return { products: (products?.nodes ?? []).map(normalised), next: products?.pageInfo.hasNextPage ? products.pageInfo.endCursor : null }
    },
  }
}

/**
 * Local development without a Shopify app (docs/setup/local.md): approval comes straight back, and every call is
 * logged and answers an empty shop, so the screens' flow and empty state can be worked on.
 */
export const localShopify = (): ShopifyApi => ({
  authorizeUrl: (shop, state, redirectUri) => {
    logEvent({ event: 'shopify_local', api: 'store', code: 'authorize' })
    const url = new URL(redirectUri)
    url.searchParams.set('shop', shop)
    url.searchParams.set('code', 'local')
    url.searchParams.set('state', state)
    url.searchParams.set('hmac', 'local')
    return url.toString()
  },
  verifyCallback: async (query) => query.get('hmac') === 'local',
  exchange: async () => {
    logEvent({ event: 'shopify_local', api: 'store', code: 'exchange' })
    return 'local'
  },
  products: async () => {
    logEvent({ event: 'shopify_local', api: 'store', code: 'products' })
    return { products: [], next: null }
  },
})
