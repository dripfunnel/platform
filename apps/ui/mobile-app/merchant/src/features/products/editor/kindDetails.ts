import type { DownloadFile, ProductKindInput, ProductKindView } from '../../../api/productKinds'

// What a download, a service or a gift card adds to a product, as the editor's kind cards edit it (FIRST-RELEASE (store) §11).
// A download's licence keys are the web portal's for now: a stored pool stays as it is and a new download is a file.

export const productKinds = ['physical', 'digital', 'service', 'gift_card'] as const
export type ProductKind = (typeof productKinds)[number]

export const kindOf = (type: string): ProductKind => productKinds.find((kind) => kind === type) ?? 'physical'

export type KindDetails = {
  download: {
    mode: 'file' | 'keys'
    file: DownloadFile | null
    limit: number
    days: number
    /** The file's upload is on its way, or was refused with this code (the draft keeps the progress, as a photo's does). */
    uploading: boolean
    refusal: string | null
  }
  service: { duration: string; location: string }
  /** Null: cards never expire. `shortestMonths` is what the API read back, null until the product is saved as a gift card. */
  giftCard: { expiryMonths: number | null; shortestMonths: number | null }
}

// The API's own defaults: a link that works 5 times over 30 days, a card that never expires.
export const blankDetails = (): KindDetails => ({
  download: { mode: 'file', file: null, limit: 5, days: 30, uploading: false, refusal: null },
  service: { duration: '', location: '' },
  giftCard: { expiryMonths: null, shortestMonths: null },
})

/** The stored details, over the defaults for the kinds the product isn't. */
export const detailsOf = (view: ProductKindView | null): KindDetails => {
  const blank = blankDetails()
  if (!view) return blank
  return {
    download: view.download ? { mode: view.download.mode, file: view.download.file, limit: view.download.limit, days: view.download.days, uploading: false, refusal: null } : blank.download,
    service: view.service ? { duration: view.service.duration ?? '', location: view.service.location ?? '' } : blank.service,
    giftCard: view.giftCard ? { expiryMonths: view.giftCard.expiryMonths, shortestMonths: view.giftCard.shortestMonths } : blank.giftCard,
  }
}

export type KindProblem = 'file' | 'fileBusy'

/** What stops a kind's details saving; the API checks them all again. */
export const kindProblemsOf = (kind: ProductKind, { download }: KindDetails): KindProblem[] => {
  if (kind !== 'digital') return []
  if (download.uploading) return ['fileBusy']
  return download.mode === 'file' && !download.file ? ['file'] : []
}

/** The kind's own card as `saveProductKind` takes it; nothing for a physical item. */
export const kindInputOf = (kind: ProductKind, { download, service, giftCard }: KindDetails): ProductKindInput | null => {
  if (kind === 'digital') return { download: { mode: download.mode, fileId: download.mode === 'file' ? (download.file?.id ?? null) : null, limit: download.limit, days: download.days } }
  if (kind === 'service') return { service: { duration: service.duration.trim() || null, location: service.location.trim() || null } }
  if (kind === 'gift_card') return { giftCard: { expiryMonths: giftCard.expiryMonths } }
  return null
}

type Kinded = { kind: ProductKind; details: KindDetails }

/** Whether the kind's card needs saving: a new kind, or its details changed. */
export const kindChanged = (draft: Kinded, saved: Kinded): boolean => draft.kind !== saved.kind || JSON.stringify(kindInputOf(draft.kind, draft.details)) !== JSON.stringify(kindInputOf(saved.kind, saved.details))
