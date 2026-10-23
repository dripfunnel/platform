import { z } from 'zod'
import { allPages, pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Warehouse (SetOps "Warehouse"; FIRST-RELEASE (store) §15): the store's own stock locations to manage, and its suppliers' named
// apart and read-only.

const addressSchema = z.object({ line1: z.string().nullable(), line2: z.string().nullable(), city: z.string().nullable(), region: z.string().nullable(), postalCode: z.string().nullable(), country: z.string().nullable() })
export type PlaceAddress = z.infer<typeof addressSchema>

const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  units: z.number().int(),
  revision: z.number().int(),
  address: addressSchema.nullable(),
  supplierId: z.string().nullable(),
  supplierName: z.string().nullable(),
})
export type Place = z.infer<typeof placeSchema>

/** Every location the store can see: its own, and its suppliers' (marked by `supplierId`). */
export const loadPlaces = (client: ApiClient): Promise<Place[]> =>
  allPages(
    async (after) =>
      (
        await typedQuery(client)(
          'query Places($after: String) { warehouses(first: 50, after: $after) { nodes { id name isDefault units revision supplierId supplierName address { line1 line2 city region postalCode country } } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } } }',
          z.object({ warehouses: z.object({ nodes: z.array(placeSchema), pageInfo: pageInfoSchema }) }),
          { after },
        )
      ).warehouses,
  )

export type PlaceInput = { name: string; address: { line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string } }

/** A new location (no id), or the next revision of one. */
export const savePlace = async (client: ApiClient, id: string | null, revision: number | null, input: PlaceInput): Promise<void> => {
  await typedQuery(client)(
    'mutation SavePlace($id: ID, $r: Int, $input: WarehouseInput!) { saveWarehouse(id: $id, revision: $r, input: $input) }',
    z.object({ saveWarehouse: z.string().nullable() }),
    { id, r: revision, input },
  )
}

/** New products start here; stock already elsewhere stays where it is. */
export const makeDefaultPlace = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation MakeDefaultPlace($id: ID!) { setDefaultWarehouse(id: $id) }', z.object({ setDefaultWarehouse: z.boolean().nullable() }), { id })
}

/** Refused while it holds stock (`WAREHOUSE_HOLDS_STOCK`) or is the default (`DEFAULT_WAREHOUSE`). */
export const deletePlace = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation DeletePlace($id: ID!) { deleteWarehouse(id: $id) }', z.object({ deleteWarehouse: z.boolean().nullable() }), { id })
}
