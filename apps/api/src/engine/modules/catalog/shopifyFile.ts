import { csvLine } from '#core/csv'

// Products read from a connected shop (CATALOG K7) written as Shopify's own product CSV, so a connected import
// is checked, confirmed and run exactly as an uploaded Shopify export is (importFile.ts).

export interface ShopProduct {
  /** Shopify's id (`gid://shopify/Product/…`), which the picker sends back. */
  id: string
  handle: string
  title: string
  descriptionHtml: string
  status: string
  options: string[]
  images: { url: string; alt: string | null }[]
  variants: { sku: string | null; barcode: string | null; price: string | null; compareAtPrice: string | null; cost: string | null; grams: number | null; quantity: number | null; values: string[] }[]
}

export const shopifyHeader = [
  'Handle', 'Title', 'Body (HTML)', 'Status', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Barcode', 'Variant Price', 'Variant Compare At Price', 'Cost per item', 'Variant Grams', 'Variant Inventory Qty', 'Image Src', 'Image Alt Text',
]

/** A product's rows: its own fields on the first, a variant a row, its images down the rows beside them. */
export const shopifyRows = (p: ShopProduct): string[] => {
  const rows = Math.max(p.variants.length, p.images.length, 1)
  return Array.from({ length: rows }, (_, i) => {
    const first = i === 0
    const v = p.variants[i]
    const image = p.images[i]
    const options = [0, 1, 2].flatMap((n) => [first ? (p.options[n] ?? '') : '', v?.values[n] ?? ''])
    return csvLine([
      p.handle,
      first ? p.title : '',
      first ? p.descriptionHtml : '',
      first ? (p.status === 'ACTIVE' ? 'active' : p.status === 'ARCHIVED' ? 'archived' : 'draft') : '',
      ...options,
      v?.sku ?? '',
      v?.barcode ?? '',
      v?.price ?? '',
      v?.compareAtPrice ?? '',
      v?.cost ?? '',
      v?.grams ?? '',
      // Shopify lets a count go below zero; ours starts at none.
      v?.quantity === null || v?.quantity === undefined ? '' : Math.max(0, v.quantity),
      image?.url ?? '',
      image?.alt ?? '',
    ])
  })
}
