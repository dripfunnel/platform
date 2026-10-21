import { maxKeyLength, maxKeysPerSave, type DownloadFile, type ProductKindInput, type ProductKindView } from '../../api/productKinds'

// What a download, a service or a gift card adds to a product, as the editor's kind cards edit it (CatEditor; CATALOG
// T14). Keys typed here go into the pool once saved and are never read back, only counted.

export interface KindDetails {
  download: { mode: 'file' | 'keys'; file: DownloadFile | null; limit: number; days: number }
  /** New licence keys, one a line, added to the pool on save. */
  keys: string
  service: { duration: string; location: string }
  /** Null: cards never expire. */
  giftCard: { expiryMonths: number | null }
}

// The API's own defaults (migration 0110): a link that works 5 times over 30 days, a card that never expires.
export const blankDetails = (): KindDetails => ({
  download: { mode: 'file', file: null, limit: 5, days: 30 },
  keys: '',
  service: { duration: '', location: '' },
  giftCard: { expiryMonths: null },
})

/** The stored details, over the defaults for the kinds the product isn't. */
export const detailsOf = (view: ProductKindView | null): KindDetails => {
  const blank = blankDetails()
  if (!view) return blank
  return {
    download: view.download ? { mode: view.download.mode, file: view.download.file, limit: view.download.limit, days: view.download.days } : blank.download,
    keys: '',
    service: view.service ? { duration: view.service.duration ?? '', location: view.service.location ?? '' } : blank.service,
    giftCard: view.giftCard ? { expiryMonths: view.giftCard.expiryMonths } : blank.giftCard,
  }
}

/** The keys as they will be sent: trimmed, blank lines and repeats dropped. */
export const keysOf = (text: string): string[] => [...new Set(text.split('\n').map((k) => k.trim()).filter((k) => k !== ''))]

export type KindProblem = 'file' | 'keys'

/** What stops a kind's details saving; the API checks them all again. */
export const kindProblemsOf = (kind: string, details: KindDetails): KindProblem[] => {
  if (kind !== 'digital') return []
  const keys = keysOf(details.keys)
  if (details.download.mode === 'file') return details.download.file ? [] : ['file']
  return keys.length > maxKeysPerSave || keys.some((k) => k.length > maxKeyLength) ? ['keys'] : []
}

/** The kind's own card as `saveProductKind` takes it; nothing for a physical item. */
export const kindInputOf = (kind: string, details: KindDetails): ProductKindInput | null => {
  const { download, service, giftCard } = details
  if (kind === 'digital') return { download: { mode: download.mode, fileId: download.mode === 'file' ? (download.file?.id ?? null) : null, limit: download.limit, days: download.days } }
  if (kind === 'service') return { service: { duration: service.duration.trim() || null, location: service.location.trim() || null } }
  if (kind === 'gift_card') return { giftCard: { expiryMonths: giftCard.expiryMonths } }
  return null
}

/** Whether the kind's card needs saving: a new kind, or its details changed (keys aside, which are added on their own). */
export const kindChanged = (kind: string, details: KindDetails, savedKind: string, saved: KindDetails): boolean =>
  kind !== savedKind || JSON.stringify(kindInputOf(kind, details)) !== JSON.stringify(kindInputOf(kind, saved))
