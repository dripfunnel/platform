import { Kind, parse, validate, type SelectionSetNode } from 'graphql'
import { describe, expect, it } from 'vitest'
import { catalogueQueries } from '@dripfunnel/storefront-core'
import { snapshotCatalogueSchema } from '@dripfunnel/storefront-core/guard'
import { maxCatalogueVersionPages } from '#saas/storefronts/index'
import { maxRecordedAnswers, maxRecordedCollections, maxRecordedProducts, recordedQueries } from './record'
import { shopSchema } from './schema'

// Card #1011: the answers the platform records must hold every field core's questions read, and fit the snapshot core reads.

const paths = (source: string): Set<string> => {
  const found = new Set<string>()
  const walk = (set: SelectionSetNode | undefined, prefix: string) => {
    for (const s of set?.selections ?? []) {
      if (s.kind !== Kind.FIELD) continue
      found.add(`${prefix}${s.name.value}`)
      walk(s.selectionSet, `${prefix}${s.name.value}.`)
    }
  }
  const operation = parse(source).definitions[0]
  if (operation?.kind === Kind.OPERATION_DEFINITION) walk(operation.selectionSet, '')
  return found
}
const missing = (core: string, recorded: Set<string>, rename = (p: string) => p) => [...paths(core)].map(rename).filter((p) => !recorded.has(p))

describe('the recorded catalogue questions', () => {
  it('are valid Shop API operations', () => {
    for (const source of Object.values(recordedQueries)) expect(validate(shopSchema, parse(source))).toEqual([])
  })

  it('select every field core’s own questions read', () => {
    expect(missing(catalogueQueries.product, new Set([...paths(recordedQueries.Product), ...paths(recordedQueries.Store)]))).toEqual([])
    expect(missing(catalogueQueries.listing, paths(recordedQueries.Listing))).toEqual([])
    expect(missing(catalogueQueries.collections, paths(recordedQueries.Collections))).toEqual([])
    // A collection's own answer is its node in the list.
    expect(missing(catalogueQueries.collection, paths(recordedQueries.Collections), (p) => p.replace(/^collection/, 'collections.nodes'))).toEqual([])
    expect(missing(catalogueQueries.menu, paths(recordedQueries.Menu))).toEqual([])
  })

  it('fit the snapshot core reads at every cap', () => {
    const catalogue = {
      answers: Array.from({ length: maxRecordedAnswers }, (_, i) => ({ operation: 'Product', variables: { slug: `p${i}` }, data: {} })),
      products: Array.from({ length: maxRecordedProducts }, (_, i) => ({ slug: `p${i}`, versions: i < maxCatalogueVersionPages / 250 ? Array.from({ length: 250 }, (__, v) => `v${v}`) : [] })),
      collections: Array.from({ length: maxRecordedCollections }, (_, i) => ({ slug: `c${i}` })),
    }
    expect(snapshotCatalogueSchema.safeParse(catalogue).success).toBe(true)
  })
})
