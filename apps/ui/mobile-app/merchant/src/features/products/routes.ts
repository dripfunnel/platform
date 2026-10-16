import type { Seat } from '../../nav'

// A supplier's Products is its own tab, the merchant's lives under Catalogue (DESIGN.md §2); both open the same screens.
const base = (seat: Seat | null): string => (seat?.side === 'supplier' ? '/products' : '/catalogue')

export const productsHref = (seat: Seat | null): string => base(seat)
export const importHref = (seat: Seat | null): string => `${base(seat)}/import`
export const productHref =(seat: Seat | null, id: string): string => `${base(seat)}/${id}`
export const newProductHref = (seat: Seat | null): string => `${base(seat)}/new`
export const storyHref = (seat: Seat | null, id: string): string => `${base(seat)}/${id}/story`
