import type { CollectionCard } from '@dripfunnel/storefront-core/theme'

/** A collection's slug, the last part of its address, which `useListing` takes. */
export const slugOf = (c: CollectionCard) => c.href.split('/').filter(Boolean).pop() ?? ''
