import { z } from 'zod'
import { ApiError, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Settings › Tax setup (CatSettings tax tab and SetOps tax; FIRST-RELEASE (store) §15; SAPI 7). Tax rates come from the API, never from the app.

const classSchema = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean(), taxCode: z.string().nullable(), versions: z.number().int() })
const zoneSchema = z.object({ id: z.string(), name: z.string(), countries: z.array(z.string()), regions: z.array(z.string()), rates: z.array(z.object({ taxClassId: z.string(), rateBps: z.number().int() })) })
const setupSchema = z.object({ pricesIncludeTax: z.boolean(), classes: z.array(classSchema), zones: z.array(zoneSchema) })
export type TaxClass = z.infer<typeof classSchema>
export type TaxZone = z.infer<typeof zoneSchema>
export type TaxSetup = z.infer<typeof setupSchema>

/** Whether prices include tax, the categories with how many versions use each, and the zones' rates. */
export const loadTax = async (client: ApiClient): Promise<TaxSetup | null> =>
  (
    await typedQuery(client)(
      '{ taxSetup { pricesIncludeTax classes { id name isDefault taxCode versions } zones { id name countries regions rates { taxClassId rateBps } } } }',
      z.object({ taxSetup: setupSchema.nullable() }),
    )
  ).taxSetup

/** The flag alone: the numbers typed on products stay as they are. */
export const setPricesIncludeTax = async (client: ApiClient, included: boolean): Promise<void> => {
  await typedQuery(client)('mutation SetPricesIncludeTax($i: Boolean!) { setPricesIncludeTax(included: $i) }', z.object({ setPricesIncludeTax: z.boolean().nullable() }), { i: included })
}

/** Makes a category the default for new products. The API has no call for that alone, so it reads the category again first and sends back its name and code as they are now. */
export const makeDefaultClass = async (client: ApiClient, id: string): Promise<void> => {
  const current = (await loadTax(client))?.classes.find((taxClass) => taxClass.id === id)
  if (!current) throw new ApiError('NOT_FOUND', 'tax category')
  await typedQuery(client)(
    'mutation MakeDefaultClass($id: ID, $input: TaxClassInput!) { saveTaxClass(id: $id, input: $input) }',
    z.object({ saveTaxClass: z.string().nullable() }),
    { id: current.id, input: { name: current.name, taxCode: current.taxCode, isDefault: true } },
  )
}

/** Never the default, nor one a version uses (`DEFAULT_CLASS`, `CLASS_IN_USE`). */
export const deleteTaxClass = async (client: ApiClient, id: string): Promise<void> => {
  await typedQuery(client)('mutation DeleteTaxClass($id: ID!) { deleteTaxClass(id: $id) }', z.object({ deleteTaxClass: z.boolean().nullable() }), { id })
}

/** A new category with its rate at home, in one go on the server; the home zone is made, named `homeZoneName`, when there is none. */
export const addTaxCategory = async (client: ApiClient, name: string, rateBps: number, homeZoneName: string): Promise<void> => {
  await typedQuery(client)(
    'mutation AddTaxCategory($n: String!, $r: Int!, $h: String!) { addTaxCategory(name: $n, rateBps: $r, homeZoneName: $h) }',
    z.object({ addTaxCategory: z.string().nullable() }),
    { n: name, r: rateBps, h: homeZoneName },
  )
}

/** An existing category's rate at home; the server makes the home zone, named `homeZoneName`, when there is none. */
export const setHomeTaxRate = async (client: ApiClient, taxClassId: string, rateBps: number, homeZoneName: string): Promise<void> => {
  await typedQuery(client)(
    'mutation SetHomeTaxRate($c: ID!, $r: Int!, $h: String!) { setHomeTaxRate(taxClassId: $c, rateBps: $r, homeZoneName: $h) }',
    z.object({ setHomeTaxRate: z.boolean().nullable() }),
    { c: taxClassId, r: rateBps, h: homeZoneName },
  )
}

const invoiceSchema = z.object({ taxPerLine: z.boolean(), emailWithDispatch: z.boolean(), footer: z.string().nullable(), legalName: z.string().nullable() })
export type InvoiceSettings = z.infer<typeof invoiceSchema>

export const loadInvoiceSettings = async (client: ApiClient): Promise<InvoiceSettings | null> =>
  (await typedQuery(client)('{ invoiceSettings { taxPerLine emailWithDispatch footer legalName } }', z.object({ invoiceSettings: invoiceSchema.nullable() }))).invoiceSettings

/** The footer goes back as it is: the invoice card on the phone changes the two switches only. */
export const saveInvoiceSettings = async (client: ApiClient, input: { taxPerLine: boolean; emailWithDispatch: boolean; footer: string | null }): Promise<void> => {
  await typedQuery(client)('mutation SaveInvoiceSettings($input: InvoiceSettingsInput!) { saveInvoiceSettings(input: $input) }', z.object({ saveInvoiceSettings: z.boolean().nullable() }), { input })
}
