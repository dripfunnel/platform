import { z } from 'zod'
import { query } from './client'

// Settings › Tax setup (CatSettings tax tab and SetOps tax, FIRST-RELEASE §15; #297's API).

const classSchema = z.object({ id: z.string(), name: z.string(), isDefault: z.boolean(), taxCode: z.string().nullable(), versions: z.number().int() })
const zoneSchema = z.object({ id: z.string(), name: z.string(), countries: z.array(z.string()), regions: z.array(z.string()), rates: z.array(z.object({ taxClassId: z.string(), rateBps: z.number().int() })) })
const setupSchema = z.object({ pricesIncludeTax: z.boolean(), classes: z.array(classSchema), zones: z.array(zoneSchema) })
export type TaxClass = z.infer<typeof classSchema>
export type TaxZone = z.infer<typeof zoneSchema>
export type TaxSetupFull = z.infer<typeof setupSchema>

/** Whether prices include tax, the categories with their codes and how many versions each, and the zones' rates. */
export const loadTax = async (): Promise<TaxSetupFull | null> =>
  (
    await query(
      '{ taxSetup { pricesIncludeTax classes { id name isDefault taxCode versions } zones { id name countries regions rates { taxClassId rateBps } } } }',
      z.object({ taxSetup: setupSchema.nullable() }),
    )
  ).taxSetup

/** The flag alone: the numbers typed on products stay as they are (#297). */
export const setPricesIncludeTax = async (included: boolean): Promise<void> => {
  await query('mutation P($i: Boolean!) { setPricesIncludeTax(included: $i) }', z.object({ setPricesIncludeTax: z.boolean() }), { i: included })
}

export const saveTaxClass = async (id: string | null, input: { name: string; taxCode: string | null; isDefault: boolean }): Promise<string> =>
  (await query('mutation S($id: ID, $input: TaxClassInput!) { saveTaxClass(id: $id, input: $input) }', z.object({ saveTaxClass: z.string() }), { id, input })).saveTaxClass

/** Never the default, nor one a version uses (DEFAULT_CLASS, CLASS_IN_USE). */
export const deleteTaxClass = async (id: string): Promise<void> => {
  await query('mutation D($id: ID!) { deleteTaxClass(id: $id) }', z.object({ deleteTaxClass: z.boolean() }), { id })
}

export const saveTaxZone = async (id: string | null, input: { name: string; countries: string[]; regions: string[]; rates: { taxClassId: string; rateBps: number }[] }): Promise<string> =>
  (await query('mutation S($id: ID, $input: TaxZoneInput!) { saveTaxZone(id: $id, input: $input) }', z.object({ saveTaxZone: z.string() }), { id, input })).saveTaxZone

/** One category's rate in one zone; the zone's other rates stay as they are, whoever changed them. */
export const setTaxRate = async (zoneId: string, taxClassId: string, rateBps: number): Promise<void> => {
  await query('mutation R($z: ID!, $c: ID!, $r: Int!) { setTaxRate(zoneId: $z, taxClassId: $c, rateBps: $r) }', z.object({ setTaxRate: z.boolean() }), { z: zoneId, c: taxClassId, r: rateBps })
}

const invoiceSchema = z.object({ taxPerLine: z.boolean(), emailWithDispatch: z.boolean(), footer: z.string().nullable(), legalName: z.string().nullable() })
export type InvoiceSettings = z.infer<typeof invoiceSchema>

export const loadInvoiceSettings = async (): Promise<InvoiceSettings | null> =>
  (await query('{ invoiceSettings { taxPerLine emailWithDispatch footer legalName } }', z.object({ invoiceSettings: invoiceSchema.nullable() }))).invoiceSettings

export const saveInvoiceSettings = async (input: { taxPerLine: boolean; emailWithDispatch: boolean; footer: string | null }): Promise<void> => {
  await query('mutation I($input: InvoiceSettingsInput!) { saveInvoiceSettings(input: $input) }', z.object({ saveInvoiceSettings: z.boolean() }), { input })
}
