// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cartOf, line, shownCart, usd } from '../../test/cart'
import { createI18n } from '../platform/i18n/i18n'
import { OrderSummary } from './summary'

const { t } = createI18n('en-US')

describe('OrderSummary', () => {
  it('shows every amount as the engine answered it, sealed, with the lines only at checkout', () => {
    const cart = shownCart(cartOf([line('v1', 2)], { discounts: [{ name: 'Autumn', code: 'AUTUMN', amount: usd(560) }], shipping: usd(0), tax: { amount: usd(400), pricesIncludeTax: false }, total: usd(5440) }))
    const atCart = renderToStaticMarkup(<OrderSummary cart={cart} at="cart" locale="en-US" t={t} />)
    expect(atCart).toContain('data-df-sealed="summary"')
    expect(atCart).toContain('$56.00')
    expect(atCart).toContain('−$5.60')
    expect(atCart).toContain('Free')
    expect(atCart).toContain('Tax')
    expect(atCart).toContain('Estimated total')
    expect(atCart).toContain('$54.40')
    expect(atCart).not.toContain('Organic Cotton Tee')
    const atCheckout = renderToStaticMarkup(<OrderSummary cart={cart} at="checkout" locale="en-US" t={t} />)
    expect(atCheckout).toContain('Organic Cotton Tee × 2')
    expect(atCheckout).toContain('>Total<')
  })

  it('says when delivery is still to choose, and names tax a price already includes', () => {
    const cart = shownCart(cartOf([line('v1', 1)], { tax: { amount: usd(300), pricesIncludeTax: true } }))
    const html = renderToStaticMarkup(<OrderSummary cart={cart} at="cart" locale="en-US" t={t} />)
    expect(html).toContain('Chosen at checkout')
    expect(html).toContain('Includes $3.00 tax.')
    expect(renderToStaticMarkup(<OrderSummary cart={cart} at="checkout" locale="en-US" t={t} />)).toContain('Next step')
  })

  it('says the totals are being updated while a change waits, and lists a line that can’t be bought', () => {
    const cart = { ...shownCart(cartOf([line('v1', 2)])), pending: true }
    const html = renderToStaticMarkup(<OrderSummary cart={cart} at="checkout" locale="en-US" t={t} />)
    expect(html).toContain('Updating the totals…')
    expect(html).toContain('aria-busy="true"')
    const settled = renderToStaticMarkup(<OrderSummary cart={shownCart(cartOf([{ ...line('v1', 1), problem: 'unavailable' }]))} at="checkout" locale="en-US" t={t} />)
    expect(settled).not.toContain('Updating')
    expect(settled).toContain('Organic Cotton Tee × 1')
  })
})
