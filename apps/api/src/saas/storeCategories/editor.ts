import { z } from 'zod'
import { csvLine, parseCsv } from '#core/csv'
import { maxSampleCollections, maxSampleProducts, sampleRefPrefix } from './sample'
import { maxPhotos } from '#engine/modules/catalog/index'

// The sample editor (admin FIRST-RELEASE §11b): a category's sample stays one import file (DATA-MODEL §7.2); staff
// see it as products and collections and save it back as a file, which then goes through the same check as any sample.

export interface SampleItem {
  handle: string
  name: string
  description: string
  sku: string
  price: string
  stock: number | null
  visible: boolean
  /** Its `image` cells in file order, the first its main photo: public addresses copied at an earlier save, or `sample-photo:` refs. */
  photos: string[]
  collections: string[]
}

export interface SampleItems {
  products: SampleItem[]
  /** Every collection named, in first-seen order. */
  collections: string[]
}

const yes = new Set(['yes', 'true', '1', 'y'])

/** The stored file as rows a person edits: one product a handle (its first row), its photos, its collections. */
export const itemsOf = (file: string): SampleItems => {
  const table = parseCsv(file) ?? []
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (name: string) => header.indexOf(name)
  const at = (row: string[], name: string) => (col(name) < 0 ? '' : (row[col(name)] ?? '').trim())
  const byHandle = new Map<string, SampleItem>()
  const collections: string[] = []
  for (const row of table.slice(1)) {
    if (row.every((c) => c.trim() === '')) continue
    const handle = at(row, 'handle') || at(row, 'name')
    const names = at(row, 'collection').split(';').map((n) => n.trim()).filter((n) => n !== '')
    for (const n of names) if (!collections.includes(n)) collections.push(n)
    const seen = byHandle.get(handle)
    if (seen) {
      for (const n of names) if (!seen.collections.includes(n)) seen.collections.push(n)
      if (at(row, 'image') && !seen.photos.includes(at(row, 'image'))) seen.photos.push(at(row, 'image'))
      continue
    }
    const stock = at(row, 'stock')
    byHandle.set(handle, {
      handle,
      name: at(row, 'name'),
      description: at(row, 'description'),
      sku: at(row, 'sku'),
      price: at(row, 'price'),
      stock: stock === '' || !/^\d+$/.test(stock) ? null : Number(stock),
      visible: at(row, 'visible') === '' || yes.has(at(row, 'visible').toLowerCase()),
      photos: at(row, 'image') ? [at(row, 'image')] : [],
      collections: names,
    })
  }
  return { products: [...byHandle.values()], collections }
}

const text = (max: number) => z.string().trim().max(max)
const productInput = z.strictObject({
  name: text(255).min(1),
  description: text(5000),
  sku: text(64).min(1),
  price: z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/),
  stock: z.number().int().min(0).max(1_000_000).nullable(),
  visible: z.boolean(),
  photos: z.array(z.string().trim().min(1).max(2048)).max(maxPhotos),
  collections: z.array(text(100).min(1)).max(maxSampleCollections),
})
/** What the editor saves; counts and SKUs are checked again on the file the merchant import reads (sample.ts). */
export const sampleItemsInput = z.strictObject({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  products: z.array(productInput).max(maxSampleProducts),
  collections: z.array(text(100).min(1)).max(maxSampleCollections),
  /** Only an editor upload, never an address: no file column carries a collection's photo. */
  collectionPhotos: z
    .array(z.strictObject({ name: text(100).min(1), photo: z.string().regex(new RegExp(`^${sampleRefPrefix}[0-9a-f]{64}$`)) }))
    .max(maxSampleCollections)
    .default([]),
})
export type SampleItemsInput = z.infer<typeof sampleItemsInput>

const slug = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'product'

/**
 * The file a set of edited items saves as: our import's columns plus `collection`. A collection not in `collections`
 * is dropped from its product, so deleting a collection takes it off every product. Each photo after the first is a
 * row of its own holding only the handle and image, as the import reads a product's further photos (CATALOG K1).
 */
export const fileOf = (input: SampleItemsInput): string => {
  const used = new Set<string>()
  const handleOf = (name: string) => {
    const base = slug(name)
    let handle = base
    for (let n = 2; used.has(handle); n += 1) handle = `${base}-${n}`
    used.add(handle)
    return handle
  }
  const known = new Set(input.collections)
  const header = ['handle', 'name', 'description', 'visible', 'sku', 'price', 'stock', 'image', 'image alt', 'collection']
  const rows = input.products.flatMap((p) => {
    const handle = handleOf(p.name)
    const [main, ...more] = [...new Set(p.photos)]
    return [
      csvLine([
        handle,
        p.name,
        p.description,
        p.visible ? 'yes' : 'no',
        p.sku,
        p.price,
        p.stock === null ? '' : String(p.stock),
        main ?? '',
        main ? p.name : '',
        p.collections.filter((c) => known.has(c)).join(';'),
      ]),
      ...more.map((photo) => csvLine([handle, '', '', '', '', '', '', photo, p.name, ''])),
    ]
  })
  return [csvLine(header), ...rows].join('\n') + '\n'
}

/** A photo the editor can show: its R2 key's last segment is the sha the preview route takes. */
export const previewShaOf = (photo: string | null, photos: Readonly<Record<string, string>>): string | null => {
  if (!photo) return null
  if (photo.startsWith(sampleRefPrefix)) return photo.slice(sampleRefPrefix.length)
  const key = Object.hasOwn(photos, photo) ? photos[photo] : undefined
  return key?.split('/').at(-1) ?? null
}

/** How many products a stored file holds, for the staff list (one a handle). */
export const productCountOf = (file: string): number => itemsOf(file).products.length
