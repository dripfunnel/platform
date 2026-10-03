// What a phone shows for the matched route (designs/DF Admin Prototype.dc.html at Phone · 375):
// Find a store for the Dashboard and the Stores list, the store's own short view, or a pointer
// to a laptop for everything else.
export type PhoneView = 'find' | 'store' | 'laptop'

const findRoutes = new Set(['/_app/dashboard', '/_app/stores'])

export const phoneView = (routeId: string | undefined): PhoneView =>
  routeId === '/_app/stores_/$storeId' ? 'store' : routeId !== undefined && findRoutes.has(routeId) ? 'find' : 'laptop'
