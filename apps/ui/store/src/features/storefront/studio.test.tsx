// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorefrontMeters, StorefrontOverview } from '../../api/storefront'
import type { DesignMessage, PublishRun, StudioSession } from '../../api/studio'
import { fill, messages } from '../../messages'
import type { StorefrontApi } from './storefrontApi'
import { StudioView } from './StudioView'

// The studio (FIRST-RELEASE §14; storefront AI-STUDIO §3, §8): the sandbox's states, the frame and its messages, the chat, Edit text.

const words = messages.storefront.studio
const c = words.chat
const [firstSuggestion = '', secondSuggestion = ''] = c.suggestions
const origin = 'https://k7f3q9f2xa.webpreview.store'
const frameUrl = `${origin}/__studio/abcdefghijklmnopqrstuv/`
const ready: StudioSession = { state: 'ready', place: null, session: 'abcdefghijklmnopqrstuv', frameUrl, access: 'change', expiresAt: '2026-10-12T09:00:00Z' }
const overview: StorefrontOverview = { status: 'unpublished_changes', template: 'linen', live: { number: 12, publishedAt: '2026-10-09T10:40:00Z', template: 'linen' }, draft: { template: 'linen', changedAt: null, previewReady: true } }
const line = (id: string, role: DesignMessage['role'], text: string, more: Partial<DesignMessage> = {}): DesignMessage => ({ id, role, text, changed: [], imageAssetId: null, sampleUrl: null, canUndo: false, undone: false, createdAt: '2026-10-12T08:00:00Z', ...more })
const chat = [line('m3', 'ai', 'I warmed it up.', { changed: ['Colours'], canUndo: true }), line('m2', 'user', 'Make it warmer'), line('m1', 'note', 'template:linen')]

const fakeApi = () =>
  ({
    loadStudioSession: vi.fn().mockResolvedValue(ready),
    renewStudioSession: vi.fn().mockResolvedValue(undefined),
    loadDesignChat: vi.fn().mockResolvedValue({ messages: chat, next: null }),
    askDesign: vi.fn().mockResolvedValue('changed'),
    undoDesignChange: vi.fn().mockResolvedValue(undefined),
    loadDesignText: vi.fn().mockImplementation((_page: string, l: string) => Promise.resolve([{ key: 'pages:home.lead', text: l === 'en' ? 'Warm layers' : '' }])),
    saveDesignText: vi.fn().mockResolvedValue(undefined),
    loadStudioPages: vi.fn().mockResolvedValue({ product: { name: 'Kurta', slug: 'kurta' }, content: [{ title: 'FAQ', path: '/faq' }], custom: ['/about'] }),
    loadStudioLanguages: vi.fn().mockResolvedValue(['en', 'fr']),
    loadOverview: vi.fn().mockResolvedValue(overview),
    discardDraft: vi.fn().mockResolvedValue(undefined),
    uploadImage: vi.fn().mockResolvedValue({ ok: true, assetId: 'a-photo' }),
    publishDesign: vi.fn().mockResolvedValue('r1'),
    publishBefore: vi.fn().mockResolvedValue('r2'),
    loadPublishRun: vi.fn(),
    previewLink: vi.fn().mockResolvedValue('https://k7f3q9f2xa.webpreview.store/?preview=signed'),
    endPreviewLinks: vi.fn().mockResolvedValue(undefined),
  }) satisfies Partial<StorefrontApi>

type Fake = ReturnType<typeof fakeApi>
let api: Fake

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const usageOf = (over: Partial<StorefrontMeters['usage']> = {}): StorefrontMeters['usage'] => ({ ownKey: false, aiRequests: 40, aiPromptsUsed: 40, aiPromptsAllowed: 1000, buildMinutes: 12, publishesLast30Days: 2, recent: [], ...over })
let usage = usageOf()
const show = async (over: Partial<Fake> = {}, run: string | null = null) => {
  Object.assign(api, over)
  const onOverview = vi.fn()
  const onRun = vi.fn()
  await act(async () => {
    render(<StudioView overview={overview} templates={[{ key: 'linen', name: 'Linen', tag: '', description: '', demoUrl: null, current: true }]} storeName="Kesari" host="www.kesari.in" api={api as unknown as StorefrontApi} onExit={vi.fn()} onOverview={onOverview} usage={usage} run={run} onRun={onRun} />)
  })
  await settle()
  return { onOverview, onRun }
}
// Test frames never load (vite.config.ts), so each stands in with a window of its own that records what it is sent.
const frameWindows = new WeakMap<HTMLIFrameElement, { postMessage: ReturnType<typeof vi.fn> }>()
const frame = () => {
  const element = screen.getByTitle(words.frameTitle) as HTMLIFrameElement
  if (!frameWindows.has(element)) {
    const win = { postMessage: vi.fn() }
    frameWindows.set(element, win)
    Object.defineProperty(element, 'contentWindow', { value: win, configurable: true })
  }
  return element
}
const post = (data: unknown, from = origin, source: unknown = frame().contentWindow) => act(() => void window.dispatchEvent(new MessageEvent('message', { origin: from, data, source: source as Window })))
const prompt = () => screen.getByRole('textbox', { name: c.prompt }) as HTMLTextAreaElement

beforeEach(() => {
  api = fakeApi()
  usage = usageOf()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the studio’s frame', () => {
  it('loads the store’s preview origin with the studio-session id in its path, never the portal host', async () => {
    await show()
    expect(frame().getAttribute('src')).toBe(frameUrl)
    expect(new URL(frame().src).origin).not.toBe(window.location.origin)
    expect(api.loadStudioSession).toHaveBeenCalledWith(null)
  })

  it('refuses a frame address on the portal’s own origin', async () => {
    await show({ loadStudioSession: vi.fn().mockResolvedValue({ ...ready, frameUrl: `${window.location.origin}/__studio/abcdefghijklmnopqrstuv/` }) })
    expect(screen.queryByTitle(words.frameTitle)).toBeNull()
    expect(screen.getByText(words.sandbox.unavailable)).toBeTruthy()
  })

  it('shows another page by the frame’s own address, and hears the page it moved to from its origin only', async () => {
    await show()
    const picker = screen.getByRole('combobox', { name: words.page }) as HTMLSelectElement
    fireEvent.change(picker, { target: { value: '/products/kurta/' } })
    expect(frame().getAttribute('src')).toBe(`${frameUrl}products/kurta/`)
    post({ type: 'df-studio:page', path: '/faq' }, 'https://evil.example.com')
    post({ type: 'df-studio:page', path: '/faq' }, origin, window)
    expect(picker.value).toBe('/products/kurta/')
    post({ type: 'df-studio:page', path: '/faq' })
    expect(picker.value).toBe('/faq')
    expect(frame().getAttribute('src')).toBe(`${frameUrl}products/kurta/`)
  })

  it('lists every page of the store: core’s, the content pages and the AI’s own', async () => {
    await show()
    const picker = screen.getByRole('combobox', { name: words.page })
    const labels = within(picker).getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(expect.arrayContaining([words.routes.home, fill(words.routes.product, { name: 'Kurta' }), words.routes.terms, 'FAQ', '/about']))
  })

  it('keeps the same frame when a change is accepted: the frame reloads itself (AI-STUDIO §4 step 5)', async () => {
    await show()
    const before = frame()
    fireEvent.change(prompt(), { target: { value: 'Add a reviews section' } })
    fireEvent.keyDown(prompt(), { key: 'Enter' })
    await settle()
    expect(api.askDesign).toHaveBeenCalledWith({ text: 'Add a reviews section', imageAssetId: null, sampleUrl: null, page: '/', device: 'desktop' })
    expect(frame()).toBe(before)
    expect(frame().getAttribute('src')).toBe(frameUrl)
    expect(prompt().value).toBe('')
  })
})

describe('the sandbox’s states', () => {
  it('says "Opening your studio…" while the sandbox starts, then reads it again until ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const session = vi.fn().mockResolvedValueOnce({ ...ready, state: 'starting' }).mockResolvedValue(ready)
    await show({ loadStudioSession: session })
    expect(screen.getByText(words.sandbox.opening)).toBeTruthy()
    expect(prompt().readOnly).toBe(true)
    await act(async () => void vi.advanceTimersByTime(2_000))
    await settle()
    expect(session).toHaveBeenLastCalledWith(ready.session)
    expect(screen.queryByText(words.sandbox.opening)).toBeNull()
    expect(prompt().readOnly).toBe(false)
  })

  it('gives the place in the queue as seconds', async () => {
    await show({ loadStudioSession: vi.fn().mockResolvedValue({ ...ready, state: 'queued', place: 2 }) })
    expect(screen.getByText(fill(words.sandbox.queued, { seconds: '40' }))).toBeTruthy()
  })

  it('says "Finishing your previous change…" while another tab changes the store', async () => {
    await show({ loadStudioSession: vi.fn().mockResolvedValue({ ...ready, state: 'busy' }) })
    expect(screen.getByText(words.sandbox.finishing)).toBeTruthy()
    expect(screen.queryByRole('button', { name: c.undo })).toBeNull()
  })

  it('says "Checking your change…" while a change is checked, one at a time', async () => {
    let answer: (outcome: string) => void = () => undefined
    await show({ askDesign: vi.fn().mockReturnValue(new Promise<string>((resolve) => (answer = resolve))) })
    fireEvent.click(screen.getByRole('button', { name: firstSuggestion }))
    await settle()
    expect(screen.getByText(words.sandbox.checking)).toBeTruthy()
    expect(screen.queryByRole('button', { name: secondSuggestion })).toBeNull()
    await act(async () => answer('changed'))
    await settle()
    expect(screen.queryByText(words.sandbox.checking)).toBeNull()
  })

  it('renews the session every 2 minutes, and a refused renewal ends it with Reopen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const renew = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new ApiError('SESSION_ENDED', 'Ended.'))
    await show({ renewStudioSession: renew })
    await act(async () => void vi.advanceTimersByTime(120_000))
    expect(renew).toHaveBeenCalledWith(ready.session)
    expect(screen.queryByText(words.sandbox.ended)).toBeNull()
    await act(async () => void vi.advanceTimersByTime(120_000))
    await settle()
    expect(screen.getByText(words.sandbox.ended)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.sandbox.reopen }))
    await settle()
    expect(api.loadStudioSession).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(words.sandbox.ended)).toBeNull()
  })

  it('keeps the session when a renewal only failed to arrive', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await show({ renewStudioSession: vi.fn().mockRejectedValue(new Error('offline')) })
    await act(async () => void vi.advanceTimersByTime(120_000))
    await settle()
    expect(screen.queryByText(words.sandbox.ended)).toBeNull()
  })
})

describe('the chat', () => {
  it('shows the requests, what changed, notes, and Undo on the latest change only', async () => {
    await show()
    expect(screen.getByText('Make it warmer')).toBeTruthy()
    expect(screen.getByText('Colours')).toBeTruthy()
    expect(screen.getByText(fill(c.notes.template, { name: 'Linen' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: c.undo }))
    await settle()
    expect(api.undoDesignChange).toHaveBeenCalledWith('m3')
    expect(api.loadDesignChat).toHaveBeenCalledTimes(2)
  })

  it('says a change failed in the error line, and keeps the words when the request was refused', async () => {
    await show({ askDesign: vi.fn().mockRejectedValue(new ApiError('AI_BUDGET_REACHED', 'No.')), loadDesignChat: vi.fn().mockResolvedValue({ messages: [line('e1', 'error', 'change_failed'), ...chat], next: null }) })
    expect(screen.getByText(c.error)).toBeTruthy()
    fireEvent.change(prompt(), { target: { value: 'Bigger logo' } })
    fireEvent.click(screen.getByRole('button', { name: c.send }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(c.refused.AI_BUDGET_REACHED)
    expect(prompt().value).toBe('Bigger logo')
  })

  it('sends an uploaded image and a website address with the words', async () => {
    await show()
    fireEvent.change(document.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [new File(['x'], 'mood.png', { type: 'image/png' })] } })
    await settle()
    expect(api.uploadImage).toHaveBeenCalled()
    expect(screen.getByText('mood.png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: c.addSite }))
    fireEvent.change(screen.getByLabelText(c.siteLabel), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: c.add }))
    expect(screen.getByRole('alert').textContent).toBe(c.siteInvalid)
    fireEvent.change(screen.getByLabelText(c.siteLabel), { target: { value: 'https://www.example.com/shop' } })
    fireEvent.click(screen.getByRole('button', { name: c.add }))
    expect(screen.getByText('www.example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: c.send }))
    await settle()
    expect(api.askDesign).toHaveBeenCalledWith(expect.objectContaining({ text: c.attachedOnly, imageAssetId: 'a-photo', sampleUrl: 'https://www.example.com/shop' }))
  })

  it('takes a pasted image, and refuses one of another kind', async () => {
    await show()
    const paste = (type: string) => fireEvent.paste(prompt(), { clipboardData: { items: [{ kind: 'file', type, getAsFile: () => new File(['x'], '', { type }) }] } })
    paste('image/gif')
    expect(screen.getByRole('alert').textContent).toBe(c.refused.INVALID_IMAGE)
    paste('image/jpeg')
    await settle()
    expect(api.uploadImage).toHaveBeenCalledTimes(1)
    expect(screen.getByText(c.imageName)).toBeTruthy()
  })
})

describe('Edit text', () => {
  it('opens the words the frame picked, in every language, only in Edit text mode, and saves what changed', async () => {
    await show()
    const posted = frameWindows.get(frame())?.postMessage
    post({ type: 'df-studio:text', key: 'pages:home.lead' })
    await settle()
    expect(api.loadDesignText).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: words.edit.button }))
    expect(posted).toHaveBeenCalledWith({ type: 'df-studio:edit', on: true }, origin)
    post({ type: 'df-studio:text', key: 'pages:home.lead' }, 'https://evil.example.com')
    await settle()
    expect(api.loadDesignText).not.toHaveBeenCalled()
    post({ type: 'df-studio:text', key: 'pages:home.lead' })
    await settle()
    expect(api.loadDesignText).toHaveBeenCalledWith('home', 'en')
    expect(api.loadDesignText).toHaveBeenCalledWith('home', 'fr')
    const dialog = within(screen.getByRole('dialog', { name: words.edit.title }))
    const [main, other] = dialog.getAllByRole('textbox') as HTMLTextAreaElement[]
    expect(main?.value).toBe('Warm layers')
    fireEvent.change(main as HTMLTextAreaElement, { target: { value: '' } })
    fireEvent.click(dialog.getByRole('button', { name: words.edit.save }))
    expect(dialog.getByRole('alert').textContent).toContain('main language')
    fireEvent.change(main as HTMLTextAreaElement, { target: { value: 'Warm layers' } })
    fireEvent.change(other as HTMLTextAreaElement, { target: { value: 'Couches chaudes' } })
    fireEvent.click(dialog.getByRole('button', { name: words.edit.save }))
    await settle()
    expect(api.saveDesignText).toHaveBeenCalledTimes(1)
    expect(api.saveDesignText).toHaveBeenCalledWith('fr', 'pages:home.lead', 'Couches chaudes')
    expect(screen.getByText(words.edit.saved)).toBeTruthy()
  })

  it('sends the merchant to Products or Store info for words the theme doesn’t hold', async () => {
    await show({ loadDesignText: vi.fn().mockResolvedValue([]) })
    fireEvent.click(screen.getByRole('button', { name: words.edit.button }))
    post({ type: 'df-studio:text', key: 'common:product.title' })
    await settle()
    expect(screen.getByText(words.edit.notHere)).toBeTruthy()
  })
})

describe('the studio on a phone', () => {
  it('has Chat and Preview tabs, and asks for the phone layout', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width: 639px'), addEventListener: () => undefined, removeEventListener: () => undefined }))
    await show()
    const panel = (name: string) => document.getElementById(screen.getByRole('tab', { name }).getAttribute('aria-controls') ?? '') as HTMLElement
    expect(panel(words.panes.preview).hidden).toBe(true)
    const before = frame()
    fireEvent.keyDown(screen.getByRole('tab', { name: words.panes.chat }), { key: 'ArrowRight' })
    expect(panel(words.panes.preview).hidden).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: words.panes.preview }))
    fireEvent.click(screen.getByRole('tab', { name: words.panes.chat }))
    expect(frame()).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: firstSuggestion }))
    await settle()
    expect(api.askDesign).toHaveBeenCalledWith(expect.objectContaining({ device: 'phone' }))
  })
})

describe('discarding in the studio', () => {
  it('asks first, then reads the design again', async () => {
    const { onOverview } = await show()
    fireEvent.click(screen.getByRole('button', { name: messages.storefront.overview.discard }))
    expect(api.discardDraft).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog', { name: messages.storefront.overview.discardTitle })).getByRole('button', { name: messages.storefront.overview.discardConfirm }))
    await settle()
    expect(api.discardDraft).toHaveBeenCalledTimes(1)
    expect(onOverview).toHaveBeenCalledWith(overview)
  })
})

describe('publishing from the studio', () => {
  const p = words.publish
  const runOf = (step: PublishRun['step'], more: Partial<PublishRun> = {}): PublishRun => ({ id: 'r1', step, version: 13, repairAttempts: 0, checks: [], bisectMessageId: null, ...more })

  it('asks first, naming the version, the address and the way back, then follows the publish', async () => {
    const { onRun } = await show()
    fireEvent.click(screen.getByRole('button', { name: p.button }))
    expect(api.publishDesign).not.toHaveBeenCalled()
    const ask = within(screen.getByRole('dialog', { name: fill(p.title, { number: '13' }) }))
    expect(ask.getByText(`${fill(p.body, { host: 'www.kesari.in' })} ${fill(p.back, { number: '12' })}`)).toBeTruthy()
    fireEvent.click(ask.getByRole('button', { name: p.confirm }))
    await settle()
    expect(api.publishDesign).toHaveBeenCalledTimes(1)
    expect(onRun).toHaveBeenCalledWith('r1')
  })

  it('shows a refusal to publish in the error line', async () => {
    await show({ publishDesign: vi.fn().mockRejectedValue(new ApiError('NOTHING_TO_PUBLISH', 'No.')) })
    fireEvent.click(screen.getByRole('button', { name: p.button }))
    fireEvent.click(within(screen.getByRole('dialog', { name: fill(p.title, { number: '13' }) })).getByRole('button', { name: p.confirm }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(p.refused.NOTHING_TO_PUBLISH)
  })

  it('shows the steps while it runs, locks the studio, and says when the version is live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { onRun, onOverview } = await show({ loadPublishRun: vi.fn().mockResolvedValueOnce(runOf('queued')).mockResolvedValueOnce(runOf('checking')).mockResolvedValueOnce(runOf('going_live')).mockResolvedValue(runOf('live')) }, 'r1')
    expect(screen.getByText(p.steps.queued)).toBeTruthy()
    expect(screen.queryByRole('button', { name: p.button })).toBeNull()
    expect(prompt().readOnly).toBe(true)
    await act(async () => void vi.advanceTimersByTime(2_000))
    expect(screen.getByText(p.steps.checking)).toBeTruthy()
    await act(async () => void vi.advanceTimersByTime(2_000))
    expect(screen.getByText(p.steps.going_live)).toBeTruthy()
    await act(async () => void vi.advanceTimersByTime(2_000))
    await settle()
    expect(screen.getByText(fill(p.live, { number: '13' }))).toBeTruthy()
    expect(onRun).toHaveBeenCalledWith(null)
    expect(onOverview).toHaveBeenCalled()
  })

  it('says what failed in a refused publish, and offers to publish everything before the change to blame', async () => {
    const checks = [{ name: 'price', passed: false, words: 'On phones the buy bar covers the price.' }, { name: 'a11y', passed: true, words: null }]
    const { onRun } = await show({ loadPublishRun: vi.fn().mockResolvedValue(runOf('failed', { checks, repairAttempts: 3, bisectMessageId: 'm2' })) }, 'r1')
    const card = within(screen.getByRole('alert'))
    expect(card.getByText(fill(p.refusedTitle, { number: '13' }))).toBeTruthy()
    expect(card.getByText(`On phones the buy bar covers the price. ${p.tried} ${p.unchanged}`)).toBeTruthy()
    expect(card.getByText(fill(p.culprit, { text: 'Make it warmer' }))).toBeTruthy()
    fireEvent.click(card.getByRole('button', { name: p.before }))
    fireEvent.click(within(screen.getByRole('dialog', { name: fill(p.title, { number: '13' }) })).getByRole('button', { name: p.confirm }))
    await settle()
    expect(api.publishBefore).toHaveBeenCalledWith('m2')
    expect(onRun).toHaveBeenCalledWith('r2')
  })

  it('offers nothing to publish before when no one change is to blame', async () => {
    await show({ loadPublishRun: vi.fn().mockResolvedValue(runOf('failed')) }, 'r1')
    expect(within(screen.getByRole('alert')).getByText(`${p.refusedFallback} ${p.unchanged}`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: p.before })).toBeNull()
  })

  it('says so when a publish was rolled back after going live', async () => {
    await show({ loadPublishRun: vi.fn().mockResolvedValue(runOf('rolled_back', { checks: [{ name: 'checkout', passed: false, words: 'your new version broke the checkout on phones.' }] })) }, 'r1')
    expect(screen.getByRole('alert').textContent).toBe(fill(p.rolledBack, { number: '12', reason: 'your new version broke the checkout on phones.' }))
  })

  it('stops following a publish that isn’t this store’s', async () => {
    const { onRun } = await show({ loadPublishRun: vi.fn().mockResolvedValue(null) }, 'r9')
    expect(onRun).toHaveBeenCalledWith(null)
  })

  it('has nothing to publish without a draft', async () => {
    cleanup()
    api.loadOverview.mockResolvedValue(overview)
    await act(async () => {
      render(<StudioView overview={{ ...overview, status: 'same_as_live', draft: null }} templates={[]} storeName="Kesari" host="www.kesari.in" api={api as unknown as StorefrontApi} onExit={vi.fn()} onOverview={vi.fn()} usage={usage} run={null} onRun={vi.fn()} />)
    })
    await settle()
    expect((screen.getByRole('button', { name: p.button }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the studio’s AI line and preview links', () => {
  const pv = words.preview

  it('says how many AI requests are left, or that the store uses its own key', async () => {
    await show()
    expect(screen.getByText(fill(words.usageLine, { left: '960' }))).toBeTruthy()
    cleanup()
    usage = usageOf({ ownKey: true, aiPromptsAllowed: null })
    await show()
    expect(screen.getByText(words.usageOwn)).toBeTruthy()
  })

  it('opens the signed preview link in a new tab that carries nothing back', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    const open = vi.fn().mockReturnValue(tab)
    vi.stubGlobal('open', open)
    await show()
    fireEvent.click(screen.getByRole('button', { name: pv.open }))
    await settle()
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('https://k7f3q9f2xa.webpreview.store/?preview=signed')
  })

  it('never follows a link that isn’t https, and says why a link couldn’t be made', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() }
    vi.stubGlobal('open', vi.fn().mockReturnValue(tab))
    await show({ previewLink: vi.fn().mockResolvedValueOnce('javascript:alert(1)').mockRejectedValueOnce(new ApiError('NOT_CONNECTED', 'No.')) })
    fireEvent.click(screen.getByRole('button', { name: pv.open }))
    await settle()
    expect(tab.close).toHaveBeenCalledTimes(1)
    expect(tab.location.href).toBe('')
    fireEvent.click(screen.getByRole('button', { name: pv.open }))
    await settle()
    expect(tab.close).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert').textContent).toBe(pv.refused.NOT_CONNECTED)
  })

  it('ends every preview link only after asking', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: pv.more }))
    fireEvent.click(screen.getByRole('menuitem', { name: pv.end }))
    expect(api.endPreviewLinks).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog', { name: pv.endTitle })).getByRole('button', { name: pv.endConfirm }))
    await settle()
    expect(api.endPreviewLinks).toHaveBeenCalledTimes(1)
    expect(screen.getByText(pv.ended)).toBeTruthy()
  })

  it('offers no preview before the draft has one', async () => {
    cleanup()
    await act(async () => {
      render(<StudioView overview={{ ...overview, draft: { template: 'linen', changedAt: null, previewReady: false } }} templates={[]} storeName="Kesari" host={null} api={api as unknown as StorefrontApi} onExit={vi.fn()} onOverview={vi.fn()} usage={usage} run={null} onRun={vi.fn()} />)
    })
    await settle()
    expect(screen.queryByRole('button', { name: pv.open })).toBeNull()
  })
})
