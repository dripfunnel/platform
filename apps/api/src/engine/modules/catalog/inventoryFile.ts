import { parseCsv } from '#core/csv'
import { importLimits, type ImportProblem, type PlannedProduct } from './importFile'
import { slugFrom } from './rules'

// Shopify's inventory export (Products › Inventory › Export; CATALOG-DESIGN K5): one row per item per location.
// Our stock is its Available count; rows are matched to the products file's versions by handle and option values,
// or by SKU when the row has one.

export interface InventoryRow {
  line: number
  handle: string
  choices: string[]
  sku: string
  location: string
  available: number
}

export type InventoryRefusal = 'NOT_INVENTORY_FILE' | 'TOO_MANY_ROWS' | 'TOO_MANY_LOCATIONS'

const asProblem = (line: number, column: string | null, code: ImportProblem['code']): ImportProblem => ({ line, column, code, file: 'inventory' })

export const readInventory = (text: string): { rows: InventoryRow[]; problems: ImportProblem[] } | InventoryRefusal => {
  const table = parseCsv(text)
  const numbered = (table ?? []).map((cells, i) => ({ line: i + 1, cells })).filter((r) => r.cells.some((c) => c.trim() !== ''))
  const head = numbered[0]?.cells.map((h) => h.trim())
  if (!head) return 'NOT_INVENTORY_FILE'
  const lower = head.map((h) => h.toLowerCase())
  const at = (name: string) => lower.findIndex((h) => h === name)
  const handle = at('handle')
  const location = at('location')
  const available = lower.findIndex((h) => h.startsWith('available'))
  if (handle < 0 || location < 0 || available < 0) return 'NOT_INVENTORY_FILE'
  const body = numbered.slice(1)
  if (body.length > importLimits.rows) return 'TOO_MANY_ROWS'
  if (new Set(body.map((r) => r.cells[location]?.trim() ?? '')).size > importLimits.locations) return 'TOO_MANY_LOCATIONS'
  const options = [1, 2, 3].map((n) => at(`option${n} value`))
  const sku = at('sku')
  const rows: InventoryRow[] = []
  const problems: ImportProblem[] = []
  for (const { line, cells } of body) {
    const cell = (i: number) => cells[i]?.trim() ?? ''
    const slug = slugFrom(cell(handle))
    if (slug === '') {
      problems.push(asProblem(line, head[handle] ?? null, 'HANDLE_REQUIRED'))
      continue
    }
    const place = cell(location)
    if (place === '') {
      problems.push(asProblem(line, head[location] ?? null, 'LOCATION_REQUIRED'))
      continue
    }
    const count = cell(available)
    // Shopify writes "not stocked" where the item isn't kept at that location: nothing to bring, and said so.
    if (count === '' || count.toLowerCase() === 'not stocked') {
      problems.push(asProblem(line, head[available] ?? null, count === '' ? 'NO_COUNT' : 'NOT_STOCKED'))
      continue
    }
    const n = /^\d+$/.test(count) ? Number(count) : null
    if (n === null || n > importLimits.maxStock) {
      problems.push(asProblem(line, head[available] ?? null, 'BAD_NUMBER'))
      continue
    }
    rows.push({ line, handle: slug, choices: options.map(cell), sku: sku < 0 ? '' : cell(sku), location: place, available: n })
  }
  return { rows, problems }
}

const sameChoices = (product: PlannedProduct, versionChoices: readonly string[], row: InventoryRow): boolean => {
  // Shopify's simple product is the one option "Title" with the value "Default Title" (importFile.ts).
  if (product.input.options.length === 0) return row.choices.every((c) => ['', 'default title'].includes(c.toLowerCase()))
  return versionChoices.every((c, i) => c.toLowerCase() === (row.choices[i] ?? '').toLowerCase())
}

/**
 * Each row's count onto its product's version, per location. The products file's own counts are dropped: the
 * inventory file's replace them. `refused` are the handles of products the check refused; their rows are left alone.
 */
export const applyInventory = (products: PlannedProduct[], rows: readonly InventoryRow[], refused: ReadonlySet<string>): { locations: string[]; problems: ImportProblem[] } => {
  const byHandle = new Map(products.map((p) => [p.handle, p]))
  const locations: string[] = []
  const problems: ImportProblem[] = []
  for (const p of products) p.stock = p.stock.map(() => null)
  for (const row of rows) {
    const product = byHandle.get(row.handle)
    if (!product) {
      if (!refused.has(row.handle)) problems.push(asProblem(row.line, 'Handle', 'INVENTORY_UNMATCHED'))
      continue
    }
    const versions = product.input.versions
    const bySku = row.sku === '' ? -1 : versions.findIndex((v) => v.sku?.toLowerCase() === row.sku.toLowerCase())
    const index = bySku >= 0 ? bySku : versions.findIndex((v) => sameChoices(product, v.choices, row))
    if (index < 0) {
      problems.push(asProblem(row.line, 'Handle', 'INVENTORY_UNMATCHED'))
      continue
    }
    if (!locations.includes(row.location)) locations.push(row.location)
    // A location is uploaded text: a prototype-less object keeps names like `__proto__` and `constructor` plain keys.
    const counts = (product.stockAt ??= Object.create(null) as Record<string, (number | null)[]>)
    const own = (counts[row.location] ??= versions.map(() => null))
    own[index] = row.available
  }
  return { locations, problems }
}
