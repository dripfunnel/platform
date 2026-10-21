// Customers live under More › Your shop (DESIGN.md §2); one customer opens on its own screen with the shell's Back.
export const customersHref = '/more/customers'
export const customerHref = (id: string): string => `/more/customers/${id}`

// A customer's order opens on the Orders tab's own screen for it.
export const orderHref = (id: string): string => `/orders/${id}`
