import { basics, type ShopRequest } from './preview'

const usd = (cents: number) => ({ amount: String(cents), currency: 'USD' })
export type Line = { versionId: string; quantity: number; problem: string | null; available: number | null }
// A code held in the cart applies only from two items up, as BUY2GET1 does.
export const cartOf = (lines: Line[], codes: string[] = []) => {
  const sub = lines.reduce((n, l) => n + 2800 * l.quantity, 0)
  return { id: 'c1', currency: 'USD', email: null, phone: null, note: null, needsShipping: true, checkoutStep: 'contact', problems: [], readyToPay: false, deliverable: null, shippingOption: null, lines: lines.map((l) => ({ versionId: l.versionId, quantity: l.quantity, productName: `Tee ${l.versionId}`, productSlug: 'tee', versionName: 'Sand / M', photoUrl: null, unitPrice: usd(2800), lineTotal: usd(2800 * l.quantity), discount: null, available: l.available, problem: l.problem })), subtotal: usd(sub), discount: null, discounts: [], codes: codes.map((code) => ({ code, state: sub >= 5600 ? 'APPLIED' : 'NOT_ELIGIBLE' })), shipping: null, shippingDiscount: null, tax: null, total: usd(sub), amountDue: usd(sub), shippingAddress: null, billingAddress: null, shippingOptions: [] }
}

/** A Shop API holding one cart: `refuse` makes the next change fail, `down` makes reading it fail. */
export const cartApi = (lines: Line[]) => {
  const state = { lines, refuse: false, down: false, codes: [] as string[] }
  const answer = (r: ShopRequest): unknown => {
    if (r.query.startsWith('query Cart')) return state.down ? { errors: [{ message: 'down', extensions: { code: 'UNAVAILABLE' } }] } : { data: { cart: cartOf(state.lines, state.codes) } }
    if (r.query.includes('setCartQuantity')) {
      if (state.refuse) return { errors: [{ message: 'gone', extensions: { code: 'UNAVAILABLE' } }] }
      const q = Number(r.variables['quantity'])
      state.lines = state.lines.flatMap((l) => (l.versionId === r.variables['versionId'] ? (q > 0 ? [{ ...l, quantity: q }] : []) : [l]))
      return { data: { setCartQuantity: { cartToken: null, cart: cartOf(state.lines, state.codes) } } }
    }
    if (r.query.includes('applyCode')) {
      const ok = r.variables['code'] === 'AUTUMN'
      if (ok) state.codes = ['AUTUMN']
      return { data: { applyCode: { state: ok ? 'APPLIED' : 'INVALID', cart: cartOf(state.lines, state.codes) } } }
    }
    return basics(r)
  }
  return { state, answer }
}
