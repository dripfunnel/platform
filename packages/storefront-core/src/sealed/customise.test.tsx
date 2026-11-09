// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cartOf, line, usd } from '../../test/cart'
import { Provided, shopAnswering } from '../../test/shop'
import { EditAnswers, LineAnswers } from '../cart/answers'
import { AddToCart, BuyNow } from '../cart/buttons'
import { viewCart } from '../cart/cart'
import { createShopClient } from '../platform/api/client'
import { storedShopState } from '../platform/api/tokens'
import { moneySchema } from '../pricing/money'
import { rememberQuestions, type Question } from '../products/questions'
import { rootOf } from './element'

// The customisation modal (storefront ARCHITECTURE §3.5; #1372): opened by Add to cart and Buy now for a product with
// questions, its total the Shop API's quote, sealed in a closed root; Edit on a customised cart line.

beforeAll(() => {
  // happy-dom has no top layer; showModal marks the dialog open, as a browser does.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

/** Queries inside the modal's dialog, in its closed root, once it has rendered (only core's own tests can reach it). */
const inside = () => {
  const host = document.querySelector('df-sealed[data-df-sealed="customise"]')
  const dialog = host && rootOf(host)?.querySelector('dialog')
  if (!dialog?.querySelector('h2')) throw new Error('No customise dialog yet.')
  return within(dialog as HTMLElement)
}

const choice = (id: string, label: string, amount: number | null, available = true) => ({ id, label, available, maxQuantity: 2, photoUrl: null, price: { mode: 'FIXED' as const, per: 'ITEM' as const, percentBps: null, amount: amount === null ? null : moneySchema.parse(usd(amount)) } })
const base = { help: null, required: false, minPicks: 0, maxPicks: 1, freePicks: 0, maxLength: 100, multiline: false, example: null, accept: 'IMAGE' as const, maxFiles: 1, versionIds: null, shownIf: null, price: null, choices: [] }
const questions: Question[] = [
  { ...base, id: 'q-wrap', kind: 'CHOICE', label: 'Gift wrap', choices: [choice('c-yes', 'Yes', 500), choice('c-gold', 'Gold foil', null)] },
  { ...base, id: 'q-note', kind: 'TEXT', label: 'Note', required: true, maxLength: 20, example: 'Happy birthday', shownIf: { questionId: 'q-wrap', choiceId: 'c-yes' } },
]
const quote = (total: number, problems: { questionId: string; reason: string }[] = []) => ({ data: { customisationQuote: { unitPrice: usd(total), lineTotal: usd(total), problems: problems.map((p) => ({ ...p, choiceId: null })) } } })

const client = () => createShopClient({ state: storedShopState })

describe('the customisation modal', () => {
  it('opens from Add to cart for a product with questions, shows the Shop API’s total, asks a condition’s question once its choice is picked, and adds with the answers', async () => {
    rememberQuestions({ id: 'p1', name: 'Mug', versionIds: ['v-q'], questions })
    const asked = shopAnswering((a) => {
      if (a.query.includes('customisationQuote')) {
        const answers = (a.variables['answers'] as unknown[]) ?? []
        return answers.length === 0 ? quote(2800) : answers.length === 1 ? quote(3300, [{ questionId: 'q-note', reason: 'REQUIRED' }]) : quote(3300)
      }
      return { data: { addToCart: { cartToken: 't', cart: cartOf([line('v-q', 1)]) } } }
    })
    const done = vi.fn()
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-q" onDone={done}>
          Add
        </AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    expect(modal.getByRole('heading', { name: 'Before you add Mug' })).toBeTruthy()
    expect(await modal.findByText('$28.00')).toBeTruthy()
    // An extra not sold in the cart's currency can't be picked.
    expect(modal.getByRole('radio', { name: /Gold foil/ })).toHaveProperty('disabled', true)
    expect(modal.queryByRole('textbox', { name: 'Note' })).toBeNull()
    await act(async () => void fireEvent.click(modal.getByRole('radio', { name: /Yes/ })))
    expect(modal.getByRole('textbox', { name: 'Note' })).toBeTruthy()
    // Confirming with the required note empty names what's missing, and adds nothing.
    await waitFor(() => expect(modal.getByText('$33.00')).toBeTruthy())
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Add to cart' })))
    expect(modal.getByText('Answer this question.')).toBeTruthy()
    expect(asked.some((a) => a.query.includes('addToCart'))).toBe(false)
    await act(async () => void fireEvent.change(modal.getByRole('textbox', { name: 'Note' }), { target: { value: '<b>Asha</b>' } }))
    await waitFor(() => expect(asked.filter((a) => a.query.includes('customisationQuote')).at(-1)?.variables['answers']).toHaveLength(2))
    await waitFor(() => expect(modal.queryByText('Answer this question.')).toBeNull())
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Add to cart' })))
    const add = asked.find((a) => a.query.includes('addToCart'))
    expect(add?.variables).toMatchObject({ versionId: 'v-q', quantity: 1, answers: [{ questionId: 'q-wrap', choices: [{ choiceId: 'c-yes', quantity: 1 }] }, { questionId: 'q-note', text: '<b>Asha</b>' }] })
    expect(done).toHaveBeenCalledWith(true)
    expect(document.querySelector('df-sealed[data-df-sealed="customise"]')).toBeNull()
  })

  it('adds a product without questions directly, as before, and loads no modal', async () => {
    const asked = shopAnswering(() => ({ data: { addToCart: { cartToken: 't', cart: cartOf([line('v-plain', 1)]) } } }))
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-plain">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    expect(asked.map((a) => a.variables)).toEqual([{ versionId: 'v-plain', quantity: 1, gift: null }])
    expect(document.querySelector('df-sealed[data-df-sealed="customise"]')).toBeNull()
  })

  it('goes on to checkout from Buy now once the answers are added', async () => {
    rememberQuestions({ id: 'p2', name: 'Cap', versionIds: ['v-b'], questions: [{ ...base, id: 'q-x', kind: 'TEXT', label: 'Initials' }] })
    const assign = vi.fn()
    vi.stubGlobal('location', { ...location, pathname: '/products/cap/', origin: location.origin, assign })
    shopAnswering((a) => (a.query.includes('customisationQuote') ? quote(1500) : { data: { addToCart: { cartToken: 't', cart: cartOf([line('v-b', 1)]) } } }))
    render(
      <Provided client={client()}>
        <BuyNow versionId="v-b">Buy now</BuyNow>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Buy now' })))
    const modal = await waitFor(() => inside())
    await modal.findByText('$15.00')
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Buy now' })))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/checkout/'))
  })

  it('says plainly why the cart refused, and closes on Cancel with nothing added', async () => {
    rememberQuestions({ id: 'p3', name: 'Tote', versionIds: ['v-r'], questions: [{ ...base, id: 'q-y', kind: 'TEXT', label: 'Name' }] })
    shopAnswering((a) => (a.query.includes('customisationQuote') ? quote(900) : { errors: [{ message: 'refused', extensions: { code: 'ONE_LINE_PER_VERSION' } }] }))
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-r">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    await modal.findByText('$9.00')
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Add to cart' })))
    expect(await modal.findByText(/Edit that item in your cart instead/)).toBeTruthy()
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Cancel' })))
    expect(document.querySelector('df-sealed[data-df-sealed="customise"]')).toBeNull()
  })
})

describe('a customised cart line', () => {
  const customised = viewCart(
    cartOf([
      {
        ...line('v-q', 1),
        id: 'line-1',
        problem: null,
        answers: [{ questionId: 'q-wrap', question: 'Gift wrap', kind: 'CHOICE', text: null, per: 'ITEM', amount: usd(500), choices: [{ choiceId: 'c-yes', label: 'Yes', quantity: 1, free: 0 }], uploads: [] }],
      } as ReturnType<typeof line>,
    ]) as never,
  ).lines[0]

  it('shows its answers with each extra, and Edit reopens the modal filled in and saves through updateCartLineAnswers', async () => {
    if (!customised) throw new Error('no line')
    const asked = shopAnswering((a) => {
      if (a.query.includes('query Questions')) return { data: { product: { name: 'Mug', questions: questions.map((q) => ({ ...q, choices: q.choices.map((c) => ({ ...c, photo: null })) })) } } }
      if (a.query.includes('customisationQuote')) return quote(3300)
      return { data: { updateCartLineAnswers: { cartToken: null, cart: cartOf([line('v-q', 1)]) } } }
    })
    render(
      <Provided client={client()}>
        <LineAnswers line={customised} />
        <EditAnswers line={customised} />
      </Provided>,
    )
    expect(screen.getByText('Gift wrap')).toBeTruthy()
    expect(screen.getByText(/Yes · \+\$5\.00/)).toBeTruthy()
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Edit your choices for Organic Cotton Tee' })))
    const modal = await waitFor(() => inside())
    expect(modal.getByRole('heading', { name: 'Change your choices for Mug' })).toBeTruthy()
    expect(modal.getByRole('radio', { name: /Yes/ })).toHaveProperty('checked', true)
    await act(async () => void fireEvent.change(modal.getByRole('textbox', { name: 'Note' }), { target: { value: 'Hi' } }))
    await modal.findByText('$33.00')
    await waitFor(() => expect(asked.filter((a) => a.query.includes('customisationQuote')).at(-1)?.variables['answers']).toHaveLength(2))
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Save changes' })))
    expect(asked.find((a) => a.query.includes('updateCartLineAnswers'))?.variables).toEqual({ lineId: 'line-1', answers: [{ questionId: 'q-wrap', choices: [{ choiceId: 'c-yes', quantity: 1 }] }, { questionId: 'q-note', text: 'Hi' }] })
  })

  it('offers "Check your choices" on a line whose answers no longer fit, and nothing on a plain line', () => {
    if (!customised) throw new Error('no line')
    const plain = viewCart(cartOf([line('v-p', 1)]) as never).lines[0]
    if (!plain) throw new Error('no line')
    render(
      <Provided client={client()}>
        <EditAnswers line={{ ...customised, problem: 'check_answers' }} />
        <EditAnswers line={plain} />
      </Provided>,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button').textContent).toBe('Check your choices')
  })
})
