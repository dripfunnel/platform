// Abandoned carts live under More › Your shop (DESIGN.md §2); a cart opens on its own screen with the shell's Back.
export const cartsHref = '/more/carts'
export const cartHref = (id: string): string => `/more/carts/${id}`

// A recovered cart's order opens on the Orders tab's own screen, and its shopper on Customers'.
export const orderHref = (id: string): string => `/orders/${id}`
export const customerHref = (id: string): string => `/more/customers/${id}`
