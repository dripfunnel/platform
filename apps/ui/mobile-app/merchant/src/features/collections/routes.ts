// Collections and size charts live under Catalogue (DESIGN.md §2); a supplier has neither, so these are the merchant's routes only.
export const collectionHref = (id: string): string => `/catalogue/collections/${id}`
export const newCollectionHref = (name?: string): string => (name ? `/catalogue/collections/new?name=${encodeURIComponent(name)}` : '/catalogue/collections/new')
export const sizeChartHref = (id: string): string => `/catalogue/size-charts/${id}`
