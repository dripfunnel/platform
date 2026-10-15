// Collections live under Catalogue (DESIGN.md §2); a supplier has none, so these are the merchant's routes only.
export const collectionHref = (id: string): string => `/catalogue/collections/${id}`
export const newCollectionHref = (name?: string): string => (name ? `/catalogue/collections/new?name=${encodeURIComponent(name)}` : '/catalogue/collections/new')
