// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cartOf, line, line as line_, usd } from '../../test/cart'
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
    expect(screen.getByText('Yes')).toBeTruthy()
    expect(screen.getByText('+$5.00')).toBeTruthy()
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

describe('the modal’s rules and refusals', () => {
  it('counts a text answer’s characters, shows an upload’s refusal plainly, and removes it', async () => {
    rememberQuestions({ id: 'p4', name: 'Frame', versionIds: ['v-u'], questions: [{ ...base, id: 'q-t', kind: 'TEXT', label: 'Caption', maxLength: 30 }, { ...base, id: 'q-u', kind: 'UPLOAD', label: 'Your photo' }] })
    shopAnswering(() => quote(4000))
    class Refusing {
      upload = { onprogress: null }
      onload: (() => void) | null = null
      onerror = null
      status = 413
      responseText = JSON.stringify({ errors: [{ extensions: { code: 'FILE_TOO_LARGE' } }] })
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', Refusing)
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-u">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    await act(async () => void fireEvent.change(modal.getByRole('textbox', { name: 'Caption' }), { target: { value: 'Asha’s 30th' } }))
    expect(modal.getByText(/11 of 30 characters/)).toBeTruthy()
    const input = modal.getByText('Add a photo').querySelector('input') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { files: [new File(['x'], 'big.jpg', { type: 'image/jpeg' })] } }))
    expect(await modal.findByText('That file is over 10 MB. Choose a smaller one.')).toBeTruthy()
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Remove big.jpg' })))
    expect(modal.queryByText('big.jpg')).toBeNull()
  })

  it('says so when the total can’t be worked out at confirm, and adds nothing', async () => {
    rememberQuestions({ id: 'p5', name: 'Bowl', versionIds: ['v-f'], questions: [{ ...base, id: 'q-f', kind: 'TEXT', label: 'Glaze' }] })
    const asked = shopAnswering(() => ({ errors: [{ message: 'down', extensions: { code: 'INTERNAL' } }] }))
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-f">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Add to cart' })))
    expect(await modal.findByText('We couldn’t add it. Try again.')).toBeTruthy()
    expect(asked.some((a) => a.query.includes('addToCart'))).toBe(false)
  })

  it('says when Edit can’t read the product’s questions, rather than open nothing', async () => {
    const line = viewCart(cartOf([{ ...line_('v-e', 1), id: 'line-e', answers: [{ questionId: 'q', question: 'Name', kind: 'TEXT', text: 'Asha', per: 'ITEM', amount: usd(0), choices: [], uploads: [] }] } as ReturnType<typeof line_>]) as never).lines[0]
    if (!line) throw new Error('no line')
    shopAnswering(() => ({ data: { product: null } }))
    render(
      <Provided client={client()}>
        <EditAnswers line={line} />
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button')))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

describe('answers in the order summary at review', () => {
  it('lists each answer on its own row, worded as the cart line words them', async () => {
    const { OrderSummary } = await import('./summary')
    const { createI18n } = await import('../platform/i18n/i18n')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { t } = createI18n('en-US')
    const cart = viewCart(
      cartOf([
        {
          ...line_('v-s', 1),
          id: 'line-s',
          answers: [
            { questionId: 'a', question: 'Toppings', kind: 'CHOICE', text: null, per: 'ITEM', amount: usd(500), choices: [{ choiceId: 'c1', label: 'Cheese', quantity: 2, free: 0 }, { choiceId: 'c2', label: 'Olives', quantity: 1, free: 0 }], uploads: [] },
            { questionId: 'b', question: 'Your photos', kind: 'UPLOAD', text: null, per: 'LINE', amount: usd(0), choices: [], uploads: [{ id: 'f1', kind: 'image' }, { id: 'f2', kind: 'image' }] },
          ],
        } as ReturnType<typeof line_>,
      ]) as never,
    )
    const html = renderToStaticMarkup(<OrderSummary cart={cart} at="checkout" locale="en-US" t={t} />)
    expect(html).toContain('Toppings: Cheese × 2 and Olives')
    expect(html).toContain('Your photos: 2 files')
  })
})

describe('the modal’s last rules', () => {
  it('clears an optional pick-one answer with None', async () => {
    rememberQuestions({ id: 'p6', name: 'Card', versionIds: ['v-n'], questions: [{ ...base, id: 'q-n', kind: 'CHOICE', label: 'Envelope', choices: [choice('c-red', 'Red', 0)] }] })
    const asked = shopAnswering(() => quote(500))
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-n">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    expect(modal.getByRole('radio', { name: 'None' })).toHaveProperty('checked', true)
    await act(async () => void fireEvent.click(modal.getByRole('radio', { name: /Red/ })))
    await act(async () => void fireEvent.click(modal.getByRole('radio', { name: 'None' })))
    await waitFor(() => expect(asked.at(-1)?.variables['answers']).toEqual([]))
  })

  it('never keeps a file removed while it was still uploading, and takes it back', async () => {
    rememberQuestions({ id: 'p7', name: 'Print', versionIds: ['v-p'], questions: [{ ...base, id: 'q-p', kind: 'UPLOAD', label: 'Your photo' }] })
    const asked = shopAnswering(() => quote(900))
    let finish: () => void = () => undefined
    class Slow {
      upload = { onprogress: null }
      onload: (() => void) | null = null
      onerror = null
      status = 200
      responseText = JSON.stringify({ id: 'late-file', kind: 'image' })
      open() {}
      setRequestHeader() {}
      send() {
        finish = () => this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', Slow)
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-p">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    const input = modal.getByText('Add a photo').querySelector('input') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] } }))
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Remove me.jpg' })))
    await act(async () => finish())
    // The file that arrived after its row was removed is deleted at once.
    const fetched = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
    await waitFor(() => expect(fetched.some(([url, init]) => url === '/shop-api/uploads/late-file' && init.method === 'DELETE')).toBe(true))
    expect(asked.filter((a) => a.query.includes('customisationQuote')).every((a) => JSON.stringify(a.variables['answers']) === '[]')).toBe(true)
    expect(modal.queryByText('me.jpg')).toBeNull()
  })

  it('shows keyboard focus on the file button, whose input is visually hidden', async () => {
    const { sealedCss } = await import('./styles')
    expect(sealedCss('customise')).toContain('label[part~=button]:has(input:focus-visible)')
  })
})

describe('leaving the modal', () => {
  it('takes back the files uploaded in it when the shopper cancels', async () => {
    rememberQuestions({ id: 'p8', name: 'Poster', versionIds: ['v-c'], questions: [{ ...base, id: 'q-c', kind: 'UPLOAD', label: 'Your photo' }] })
    shopAnswering(() => quote(1200))
    class Quick {
      upload = { onprogress: null }
      onload: (() => void) | null = null
      onerror = null
      status = 200
      responseText = JSON.stringify({ id: 'kept-briefly', kind: 'image' })
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', Quick)
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-c">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    const input = modal.getByText('Add a photo').querySelector('input') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { files: [new File(['x'], 'p.jpg', { type: 'image/jpeg' })] } }))
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Cancel' })))
    const fetched = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
    await waitFor(() => expect(fetched.some(([url, init]) => url === '/shop-api/uploads/kept-briefly' && init.method === 'DELETE')).toBe(true))
  })
})

describe('closing while work is in flight', () => {
  it('takes back a file still uploading when the shopper cancels, and keeps Cancel off while adding', async () => {
    rememberQuestions({ id: 'p9', name: 'Mat', versionIds: ['v-m'], questions: [{ ...base, id: 'q-m', kind: 'UPLOAD', label: 'Your photo' }] })
    shopAnswering(() => quote(700))
    let finish: () => void = () => undefined
    class Slow {
      upload = { onprogress: null }
      onload: (() => void) | null = null
      onerror = null
      status = 200
      responseText = JSON.stringify({ id: 'after-cancel', kind: 'image' })
      open() {}
      setRequestHeader() {}
      send() {
        finish = () => this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', Slow)
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-m">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    const input = modal.getByText('Add a photo').querySelector('input') as HTMLInputElement
    await act(async () => void fireEvent.change(input, { target: { files: [new File(['x'], 'm.jpg', { type: 'image/jpeg' })] } }))
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Cancel' })))
    await act(async () => finish())
    const fetched = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
    await waitFor(() => expect(fetched.some(([url, init]) => url === '/shop-api/uploads/after-cancel' && init.method === 'DELETE')).toBe(true))
  })

  it('keeps Cancel off while the cart takes the answers', async () => {
    rememberQuestions({ id: 'p10', name: 'Jug', versionIds: ['v-j'], questions: [{ ...base, id: 'q-j', kind: 'TEXT', label: 'Name' }] })
    let release: () => void = () => undefined
    shopAnswering((a) => (a.query.includes('customisationQuote') ? quote(800) : new Promise((resolve) => (release = () => resolve({ data: { addToCart: { cartToken: 't', cart: cartOf([line('v-j', 1)]) } } })))))
    render(
      <Provided client={client()}>
        <AddToCart versionId="v-j">Add</AddToCart>
      </Provided>,
    )
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Add' })))
    const modal = await waitFor(() => inside())
    await modal.findByText('$8.00')
    await act(async () => void fireEvent.click(modal.getByRole('button', { name: 'Add to cart' })))
    await waitFor(() => expect(modal.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true))
    await act(async () => release())
  })
})
