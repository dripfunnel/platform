import { usd } from './cart'

// A placed order as the Shop API answers it (ShopOrder).

export const orderOf = (extra: Record<string, unknown> = {}) => ({
  id: 'o-1',
  number: '1051',
  state: 'placed',
  paymentState: 'paid',
  paymentMethod: 'stripe',
  paymentDueBy: null,
  shippingMethod: 'Standard delivery',
  placedAt: '2026-10-13T06:00:00Z',
  pricesIncludeTax: false,
  lines: [{ name: 'Organic Cotton Tee', versionName: 'Sand / M', quantity: 2, unitPrice: usd(2800), lineTotal: usd(5600) }],
  subtotal: usd(5600),
  discounts: [{ name: 'Autumn', amount: usd(560) }],
  shipping: usd(0),
  tax: usd(400),
  total: usd(5440),
  ...extra,
})
