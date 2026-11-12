// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckoutPage } from '../checkout/checkout'
import { PlaceOrder } from '../checkout/place'
import { createI18n } from '../platform/i18n/i18n'
import { AgeConfirmation } from './components'
import { rootOf } from './element'

const { t } = createI18n('en-US')

vi.mock('../platform/store/context', () => ({ useStorefront: () => ({ t }) }))
const words = 'Before you order: please confirm you’re 18 or over.'

afterEach(cleanup)

const box = () => {
  const host = document.querySelector('df-sealed[data-df-sealed="age"]')
  const root = host && rootOf(host)
  return root ? within(root as unknown as HTMLElement).queryByRole('checkbox', { name: words }) : null
}

describe('AgeConfirmation (#1443)', () => {
  it('shows the tick box for a cart that needs it, and reports a tick', () => {
    const onChange = vi.fn()
    render(<AgeConfirmation needed checked={false} onChange={onChange} t={t} />)
    fireEvent.click(box() as HTMLElement)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('shows nothing for a cart that does not', () => {
    render(<AgeConfirmation needed={false} checked={false} onChange={() => undefined} t={t} />)
    expect(document.querySelector('df-sealed[data-df-sealed="age"]')).toBeNull()
  })
})

describe('Place order with the age confirmation', () => {
  const checkout = (over: Partial<CheckoutPage>) => ({ phase: { kind: 'idle' }, mode: 'live', chosen: 'cod', needsAgeConfirmation: false, ageConfirmed: false, place: vi.fn(), ...over }) as unknown as CheckoutPage
  const button = () => screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement

  it('is disabled until the box is ticked', () => {
    const { rerender } = render(<PlaceOrder checkout={checkout({ needsAgeConfirmation: true })} again="Again">Place order</PlaceOrder>)
    expect(button().disabled).toBe(true)
    rerender(<PlaceOrder checkout={checkout({ needsAgeConfirmation: true, ageConfirmed: true })} again="Again">Place order</PlaceOrder>)
    expect(button().disabled).toBe(false)
  })

  it('draws the box above the button when the theme did not place it, and ticking it enables the button', () => {
    const confirmAge = vi.fn()
    const { rerender } = render(<PlaceOrder checkout={checkout({ needsAgeConfirmation: true, confirmAge })} again="Again">Place order</PlaceOrder>)
    expect(box()).not.toBeNull()
    fireEvent.click(box() as HTMLElement)
    expect(confirmAge).toHaveBeenCalledWith(true)
    rerender(<PlaceOrder checkout={checkout({ needsAgeConfirmation: true, ageConfirmed: true, confirmAge })} again="Again">Place order</PlaceOrder>)
    expect(button().disabled).toBe(false)
  })

  it('draws the box when the cart starts needing it later, and takes it away when a theme box mounts after the button', () => {
    const { rerender } = render(<PlaceOrder checkout={checkout({})} again="Again">Place order</PlaceOrder>)
    expect(box()).toBeNull()
    rerender(<PlaceOrder checkout={checkout({ needsAgeConfirmation: true })} again="Again">Place order</PlaceOrder>)
    expect(document.querySelectorAll('df-sealed[data-df-sealed="age"]')).toHaveLength(1)
    const page = checkout({ needsAgeConfirmation: true })
    rerender(
      <>
        <PlaceOrder checkout={page} again="Again">Place order</PlaceOrder>
        <AgeConfirmation needed checked={false} onChange={() => undefined} t={t} />
      </>,
    )
    expect(document.querySelectorAll('df-sealed[data-df-sealed="age"]')).toHaveLength(1)
    expect(button().disabled).toBe(true)
  })

  it('draws the box again when the theme box goes away', () => {
    const page = checkout({ needsAgeConfirmation: true })
    const theirs = <AgeConfirmation needed checked={false} onChange={() => undefined} t={t} />
    const { rerender } = render(<><PlaceOrder checkout={page} again="Again">Place order</PlaceOrder>{theirs}</>)
    expect(document.querySelectorAll('df-sealed[data-df-sealed="age"]')).toHaveLength(1)
    rerender(<PlaceOrder checkout={page} again="Again">Place order</PlaceOrder>)
    expect(document.querySelectorAll('df-sealed[data-df-sealed="age"]')).toHaveLength(1)
  })

  it('draws no second box when the theme placed one', () => {
    const page = checkout({ needsAgeConfirmation: true })
    render(
      <>
        <AgeConfirmation needed checked={false} onChange={() => undefined} t={t} />
        <PlaceOrder checkout={page} again="Again">Place order</PlaceOrder>
      </>,
    )
    expect(document.querySelectorAll('df-sealed[data-df-sealed="age"]')).toHaveLength(1)
  })

  it('is not held for a cart without an age-restricted product', () => {
    render(<PlaceOrder checkout={checkout({})} again="Again">Place order</PlaceOrder>)
    expect(button().disabled).toBe(false)
  })
})
