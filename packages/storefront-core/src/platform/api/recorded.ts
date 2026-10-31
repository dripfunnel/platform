import type { z } from 'zod'
import { collectionQuery, collectionsQuery } from '../../collections/collections'
import { listingQuery } from '../../products/listing'
import { productQuery } from '../../products/product'
import { menuQuery } from '../store/menu'
import { ShopApiError, type ShopClient } from './client'

// The live build's Shop API (storefront ARCHITECTURE §4.2): the answers the platform recorded into the catalogue
// snapshot, matched by operation and variables, so the static build asks no network and gets the browser's answers.

export type RecordedAnswer = { operation: string; variables: Record<string, unknown>; data: Record<string, unknown> }

/** Core's catalogue questions, whose answers the platform records (apps/api `recordedQueries` must select at least these). */
export const catalogueQueries = { product: productQuery, listing: listingQuery, collection: collectionQuery, collections: collectionsQuery, menu: menuQuery } as const

const operationOf = (source: string) => /^\s*query\s+([A-Za-z_]\w*)/.exec(source)?.[1] ?? null

/** Variables without the ones left empty, in a fixed order, so `{ after: null }` and `{}` ask the same question. */
const keyOf = (operation: string, variables: Record<string, unknown> | undefined) =>
  JSON.stringify([operation, Object.entries(variables ?? {}).filter(([, v]) => v !== null && v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))])

const firstOf = (variables: Record<string, unknown> | undefined) => (typeof variables?.['first'] === 'number' ? variables['first'] : null)

/** A list's first `count` nodes, from a recorded answer that asked for more: `useProducts`' and `useCollections`' smaller asks. */
const shortened = (data: Record<string, unknown>, count: number): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(data).map(([field, value]) => {
      if (!value || typeof value !== 'object' || !('nodes' in value) || !Array.isArray(value.nodes)) return [field, value]
      return [field, { ...value, nodes: value.nodes.slice(0, count), pageInfo: null }]
    }),
  )

const indexes = new WeakMap<readonly RecordedAnswer[], Map<string, Record<string, unknown>>>()
const indexOf = (answers: readonly RecordedAnswer[]) => {
  let index = indexes.get(answers)
  if (!index) indexes.set(answers, (index = new Map(answers.map((a) => [keyOf(a.operation, a.variables), a.data]))))
  return index
}

/** The recorded answer to an operation, or null; the check step's offline Shop API answers the same way. */
export const recordedAnswer = (answers: readonly RecordedAnswer[], source: string, variables?: Record<string, unknown>): Record<string, unknown> | null => {
  const operation = operationOf(source)
  if (!operation) return null
  const found = indexOf(answers).get(keyOf(operation, variables))
  if (found) return found
  const count = firstOf(variables)
  if (count === null) return null
  const rest = keyOf(operation, { ...variables, first: null })
  const longer = answers.find((a) => a.operation === operation && (firstOf(a.variables) ?? 0) > count && keyOf(a.operation, { ...a.variables, first: null }) === rest)
  return longer ? shortened(longer.data, count) : null
}

export const recordedShopClient = (answers: readonly RecordedAnswer[]): ShopClient => {
  const request = async <T>(source: string, variables?: Record<string, unknown>): Promise<T> => {
    const found = recordedAnswer(answers, source, variables)
    if (!found) throw new ShopApiError('NOT_RECORDED', 'The snapshot holds no answer to this question.')
    return found as T
  }
  const query = async <S extends z.ZodType>(operation: string, schema: S, variables?: Record<string, unknown>): Promise<z.infer<S>> => {
    const parsed = schema.safeParse(await request<unknown>(operation, variables))
    if (!parsed.success) throw new ShopApiError('BAD_RESPONSE', 'A recorded answer has an unexpected shape.')
    return parsed.data as z.infer<S>
  }
  return { request, query }
}
