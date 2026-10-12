import { cartSchema, viewCart, type Cart } from '../src/cart/cart'

// The Shop API's cart as a test answers it (ShopCart), and as core's hooks show it.

export const usd = (amount: number) => ({ amount: String(amount), currency: 'USD' })

export const line = (versionId: string, quantity: number, unit = 2800) => ({ versionId, quantity, productName: 'Organic Cotton Tee', productSlug: 'organic-cotton-tee', versionName: 'Sand / M', photoUrl: null, unitPrice: usd(unit), lineTotal: usd(unit * quantity), discount: null, available: 5, problem: null })

export const cartOf = (lines: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) => {
  const subtotal = lines.reduce((n, l) => n + Number(l.lineTotal.amount), 0)
  return { id: 'c1', currency: 'USD', email: null, phone: null, note: null, needsShipping: true, checkoutStep: 'contact', problems: [], readyToPay: false, deliverable: null, shippingOption: null, lines, subtotal: usd(subtotal), discount: null, discounts: [], codes: [], shipping: null, shippingDiscount: null, tax: null, total: usd(subtotal), amountDue: usd(subtotal), shippingAddress: null, billingAddress: null, shippingOptions: [], ...extra }
}

export const shownCart = (raw: ReturnType<typeof cartOf>): Cart => viewCart(cartSchema.parse(raw))
