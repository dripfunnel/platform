// Orders are the merchant's tab; a supplier's To ship is features/supplier (#506). The customer's screen is Customers' (More › Your shop).
export const orderHref = (id: string): string => `/orders/${id}`
export const customerHref = (id: string): string => `/more/customers/${id}`
