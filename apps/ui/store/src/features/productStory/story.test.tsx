// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductStory } from '../../api/story'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// CatAPlus driven as the merchant and a supplier would: build from modules and templates, save the draft, publish,
// and be shown what's missing when the API says so.

const words = messages.story

const api = vi.hoisted(() => ({ loadProductStory: vi.fn(), saveProductStory: vi.fn(), publishProductStory: vi.fn(), copyProductStory: vi.fn(), loadStoryBlocks: vi.fn() }))
const editorApi = vi.hoisted(() => ({ loadProduct: vi.fn(), loadProductBasics: vi.fn(), uploadVideo: vi.fn() }))
const lengthApi = vi.hoisted(() => ({ videoSeconds: vi.fn() }))
vi.mock('../../api/story', async (actual) => ({ ...(await actual<typeof import('../../api/story')>()), ...api }))
vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...editorApi }))
vi.mock('../common/videoLength', async (actual) => ({ ...(await actual<typeof import('../common/videoLength')>()), ...lengthApi }))

const { StoryEditor } = await import('./StoryEditor')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'catalog.write'] }
const staff: Acting = { ...owner, role: 'staff', permissions: ['catalog.read'] }
const supplier: Acting = { ...owner, role: 'supplier-member', tier: 'vendor-catalogue', seller: { id: 'v1', name: 'Northwind' }, permissions: ['catalog.read', 'catalog.write'] }

const story = (s: Partial<ProductStory> = {}): ProductStory => ({ revision: 0, status: 'draft', template: null, publishedAt: null, products: [], modules: [], ...s })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (acting: Acting) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly: false } }), component: Outlet })
  const editor = createRoute({ getParentRoute: () => app, path: '/products/$productId', component: () => <p>The editor</p> })
  const page = createRoute({ getParentRoute: () => app, path: '/products/$productId/story', component: StoryEditor })
  const list = createRoute({ getParentRoute: () => app, path: '/products', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([list, editor, page])]), history: createMemoryHistory({ initialEntries: ['/products/p1/story'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  return router
}

beforeEach(() => {
  editorApi.loadProduct.mockResolvedValue({ id: 'p1', name: 'Mara Linen Shirt' })
  editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'video', enabled: true, inPlan: false }], badges: [] })
  api.loadProductStory.mockResolvedValue(story())
  api.loadStoryBlocks.mockResolvedValue([{ id: 'sb1', name: 'Our studio' }])
  vi.stubGlobal('confirm', () => true)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('A+ content', () => {
  it('builds a draft from modules and saves it, the live page untouched', async () => {
    api.saveProductStory.mockImplementation(async (_p: string, _r: number, modules: unknown[]) => story({ revision: 1, modules: modules as ProductStory['modules'] }))
    await show(owner)
    expect(screen.getByText(words.empty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.kinds.banner }))
    fireEvent.change(screen.getByLabelText(words.panel.title), { target: { value: 'Made in Jaipur' } })
    fireEvent.click(screen.getByRole('button', { name: words.saveDraft }))
    await settle()
    const [productId, revision, modules] = api.saveProductStory.mock.calls[0] ?? []
    expect([productId, revision]).toEqual(['p1', 0])
    expect(modules).toEqual([expect.objectContaining({ kind: 'banner', title: 'Made in Jaipur' })])
    expect(screen.getByText(words.saved)).toBeTruthy()
  })

  it('starts from a template, asking first when it would replace modules', async () => {
    api.loadProductStory.mockResolvedValue(story({ revision: 2, modules: [{ id: 'a', kind: 'faq', title: null, body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: null }] }))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.templates.fashion }))
    fireEvent.click(within(document.querySelector('dialog') as HTMLElement).getByRole('button', { name: words.templateConfirm }))
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Large banner', 'Features', 'Image + text', 'Photo strip'])
  })

  it('publishes the saved draft, and marks what the API says is missing', async () => {
    api.loadProductStory.mockResolvedValue(story({ revision: 2, modules: [{ id: 'a', kind: 'banner', title: 'Hi', body: null, side: null, photo: { assetId: 'f1', alt: null }, items: null, photos: null, productIds: null, blockId: null, video: null }] }))
    api.publishProductStory.mockRejectedValueOnce(new ApiError('STORY_INCOMPLETE', 'finish', { gaps: [{ moduleId: 'a', field: 'alt' }] })).mockResolvedValueOnce(story({ revision: 2, status: 'live' }))
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: words.publish }))
    await settle()
    expect(api.saveProductStory).not.toHaveBeenCalled()
    expect(api.publishProductStory).toHaveBeenCalledWith('p1', 2)
    expect(screen.getByText('1 thing to fill in before publishing — it’s marked.')).toBeTruthy()
    expect(document.querySelector('.df-story-problem')?.textContent).toBe(words.gapFields.alt)
    fireEvent.click(screen.getByRole('button', { name: words.publish }))
    await settle()
    expect(screen.getByText(words.published)).toBeTruthy()
  })

  it('keeps video off the palette when the plan doesn’t have it, and caps a story at ten modules', async () => {
    await show(owner)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${words.kinds.video}`) }))
    // Said on the palette, and again when tried.
    expect(screen.getAllByText(words.videoPlan)).toHaveLength(2)
    expect(screen.queryAllByRole('region')).toHaveLength(0)
    const faq = screen.getByRole('button', { name: new RegExp(`^${words.kinds.faq}`) })
    for (let i = 0; i < 11; i++) fireEvent.click(faq)
    expect(screen.getAllByRole('region')).toHaveLength(10)
  })

  it('submits with the product for a supplier, which has no brand stories', async () => {
    await show(supplier)
    expect(screen.getByRole('button', { name: words.submit })).toBeTruthy()
    expect((screen.getByRole('button', { name: new RegExp(words.kinds.brand) }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.loadStoryBlocks).not.toHaveBeenCalled()
  })

  it('gives a supplier the Home template without its brand story, so the draft saves', async () => {
    api.saveProductStory.mockImplementation(async (_p: string, _r: number, modules: unknown[]) => story({ revision: 1, modules: modules as ProductStory['modules'] }))
    await show(supplier)
    fireEvent.click(screen.getByRole('button', { name: words.templates.home }))
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Large banner', 'Image + text', 'Photo strip'])
    fireEvent.click(screen.getByRole('button', { name: words.saveDraft }))
    await settle()
    expect((api.saveProductStory.mock.calls[0]?.[2] as { kind: string }[]).map((m) => m.kind)).toEqual(['banner', 'imageText', 'gallery'])
  })

  it('lets staff look but not change anything', async () => {
    api.loadProductStory.mockResolvedValue(story({ revision: 1, status: 'live', modules: [{ id: 'a', kind: 'faq', title: 'Questions', body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: null }] }))
    await show(staff)
    expect(screen.getByText(words.viewOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.saveDraft })).toBeNull()
    expect(screen.queryByRole('complementary', { name: words.palette })).toBeNull()
  })

  it('says a product that isn’t there isn’t there', async () => {
    editorApi.loadProduct.mockResolvedValue(null)
    await show(owner)
    expect(screen.getByRole('heading', { name: words.notFound.title })).toBeTruthy()
  })

  it('says the brand stories couldn’t be read, never that there are none', async () => {
    api.loadStoryBlocks.mockRejectedValue(new Error('offline'))
    api.loadProductStory.mockResolvedValue(story({ revision: 1, modules: [{ id: 'b', kind: 'brand', title: null, body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: null }] }))
    await show(owner)
    expect(screen.getByText(words.panel.brandFailed)).toBeTruthy()
    expect(screen.queryByText(words.panel.brandEmpty)).toBeNull()
  })
})

describe('the A+ Video block’s upload (#1448)', () => {
  const videoOn = () => editorApi.loadProductBasics.mockResolvedValue({ pricingCurrency: 'INR', unitSystem: 'metric', features: [{ key: 'video', enabled: true, inPlan: true }], badges: [] })
  const addBlock = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${words.kinds.video}`) }))
  const pick = async (file: File) => {
    fireEvent.change(document.querySelector('input[type="file"][accept="video/mp4,video/webm"]') as HTMLInputElement, { target: { files: [file] } })
    await settle()
  }
  const film = (name = 'film.mp4', size = 3 * 1024 * 1024, type = 'video/mp4') => Object.defineProperty(new File(['x'], name, { type }), 'size', { value: size })
  const save = async () => {
    fireEvent.click(screen.getByRole('button', { name: words.saveDraft }))
    await settle()
    return (api.saveProductStory.mock.calls.at(-1)?.[2] as { video?: unknown }[])[0]?.video
  }

  beforeEach(() => {
    videoOn()
    lengthApi.videoSeconds.mockResolvedValue(20)
    editorApi.uploadVideo.mockResolvedValue({ ok: true, assetId: 'v1' })
    api.saveProductStory.mockImplementation(async (_p: string, _r: number, modules: unknown[]) => story({ revision: 1, modules: modules as ProductStory['modules'] }))
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
  })

  it('uploads an MP4 within the limits, shows it, and saves it as the block’s video', async () => {
    await show(owner)
    addBlock()
    expect(screen.getByRole('button', { name: words.panel.videoUpload })).toBeTruthy()
    await pick(film())
    expect(editorApi.uploadVideo).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: words.panel.videoReplace })).toBeTruthy()
    expect(await save()).toEqual({ assetId: 'v1' })
  })

  it('takes a WebM the same way', async () => {
    await show(owner)
    addBlock()
    await pick(film('film.webm', 1024, 'video/webm'))
    expect(await save()).toEqual({ assetId: 'v1' })
  })

  it('refuses a video longer than 30 seconds or bigger than 4 MB before uploading, with the product video’s sentences', async () => {
    await show(owner)
    addBlock()
    lengthApi.videoSeconds.mockResolvedValue(45)
    await pick(film())
    expect(screen.getByText(new RegExp(messages.editor.photos.videoTooLong))).toBeTruthy()
    await pick(film('big.mp4', 5 * 1024 * 1024))
    expect(screen.getByText(new RegExp(messages.editor.photos.videoTooBig))).toBeTruthy()
    expect(editorApi.uploadVideo).not.toHaveBeenCalled()
  })

  it('says why a server refusal failed, offers Try again, and lets the failure be dismissed', async () => {
    editorApi.uploadVideo.mockResolvedValueOnce({ ok: false, code: 'TOO_LONG' }).mockResolvedValueOnce({ ok: true, assetId: 'v2' })
    await show(owner)
    addBlock()
    await pick(film())
    expect(screen.getByRole('alert').textContent).toContain(messages.editor.photos.videoRefused.TOO_LONG)
    fireEvent.click(screen.getByRole('button', { name: words.panel.videoRetry }))
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await save()).toEqual({ assetId: 'v2' })
  })

  it('lets an upload and a link replace each other', async () => {
    await show(owner)
    addBlock()
    await pick(film())
    fireEvent.change(screen.getByLabelText(words.panel.video), { target: { value: 'https://www.youtube.com/watch?v=abc' } })
    expect(screen.queryByRole('button', { name: words.panel.videoReplace })).toBeNull()
    expect(await save()).toEqual({ url: 'https://www.youtube.com/watch?v=abc' })
    await pick(film())
    expect((screen.getByLabelText(words.panel.video) as HTMLInputElement).value).toBe('')
    expect(await save()).toEqual({ assetId: 'v1' })
  })

  it('shows a saved upload again when the story is reopened', async () => {
    api.loadProductStory.mockResolvedValue(story({ revision: 1, modules: [{ id: 'a', kind: 'video', title: 'Film', body: null, side: null, photo: null, items: null, photos: null, productIds: null, blockId: null, video: { assetId: 'v9', url: null } }] }))
    await show(owner)
    fireEvent.click(screen.getByRole('region', { name: words.kinds.video }))
    expect(screen.getByRole('button', { name: words.panel.videoReplace })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(words.panel.title), { target: { value: 'Film, again' } })
    expect(await save()).toEqual({ assetId: 'v9' })
  })
})
