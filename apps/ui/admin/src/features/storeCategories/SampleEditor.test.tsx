// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreCategory } from '../../api/storeCategories'
import type { SampleDetail } from '../../api/storeCategorySample'
import type { StaffRole } from '../shell/staffRoles'
import { fill, messages } from '../../messages'

// The sample editor (admin FIRST-RELEASE §11b): every role sees a category's sample products and collections; Super
// admin adds, edits and deletes them, uploads photos, and saves the whole sample with a reason.

const words = messages.storeCategories.editor
const api = vi.hoisted(() => ({ saveStoreCategorySampleItems: vi.fn(), uploadSamplePhoto: vi.fn(), loadStoreCategorySample: vi.fn() }))
vi.mock('../../api/storeCategorySample', async (actual) => ({ ...(await actual<typeof import('../../api/storeCategorySample')>()), ...api }))

const { SampleEditor } = await import('./SampleEditor')

const footwear: StoreCategory = {
  id: 'c3',
  key: 'footwear',
  names: [{ language: 'en', name: 'Footwear' }],
  sections: ['sizeCharts'],
  archivedAt: null,
  storeCount: 0,
  hasDefaultSample: true,
  sample: { currency: 'INR', products: 2, collections: [{ name: 'Sneakers', products: 1 }, { name: 'Sandals', products: 1 }], photos: 1, uploadedAt: '2026-11-16T09:00:00.000Z' },
}
const detail: SampleDetail = {
  currency: 'INR',
  uploadedAt: '2026-11-16T09:00:00.000Z',
  collections: [
    { name: 'Sneakers', products: 1, photo: { ref: 'sample-photo:' + 'c'.repeat(64), previewUrl: '/api/store-category-photos/c3/' + 'c'.repeat(64) } },
    { name: 'Sandals', products: 1, photo: null },
  ],
  products: [
    { handle: 'runner', name: 'Runner', description: 'Light', sku: 'FW-01', price: '1999.00', stock: 10, visible: true, photos: [{ ref: 'https://x/1.jpg', previewUrl: '/api/store-category-photos/c3/' + 'a'.repeat(64) }], collections: ['Sneakers'] },
    { handle: 'sandal', name: 'Sandal', description: '', sku: 'FW-02', price: '999.00', stock: null, visible: true, photos: [], collections: ['Sandals'] },
  ],
}

const show = async (role: StaffRole, sample: SampleDetail | null = detail) => {
  const root = createRootRoute({ component: Outlet })
  const canManage = role === 'staff-super-admin'
  const page = createRoute({ getParentRoute: () => root, path: 'categories/c3/sample', component: () => <SampleEditor category={footwear} detail={sample} canManage={canManage} /> })
  const list = createRoute({ getParentRoute: () => root, path: 'categories', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([page, list]), history: createMemoryHistory({ initialEntries: ['/categories/c3/sample'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

const dialog = () => screen.getByRole('dialog', { hidden: true })
const inDialog = () => within(dialog())
const click = (el: HTMLElement) => act(async () => fireEvent.click(el))
const type = (label: string, value: string) => fireEvent.change(inDialog().getByLabelText(label), { target: { value } })
const confirm = (label: string) => click(inDialog().getByRole('button', { name: label, hidden: true }))

beforeEach(() => {
  api.saveStoreCategorySampleItems.mockReset()
  api.uploadSamplePhoto.mockReset()
})
afterEach(cleanup)

describe('the sample editor', () => {
  it('shows every role the products, with photos, and the collections, and only Super admin the controls', async () => {
    await show('staff-support')
    expect(screen.getByText('Runner')).toBeTruthy()
    expect(screen.getByText('1999.00 INR')).toBeTruthy()
    expect(screen.getByText(words.notTracked)).toBeTruthy()
    expect((screen.getByAltText(fill(words.photoAlt, { name: 'Runner' })) as HTMLImageElement).src).toContain('/api/store-category-photos/c3/')
    expect((screen.getByAltText(fill(words.photoAlt, { name: 'Sneakers' })) as HTMLImageElement).src).toContain('c'.repeat(64))
    expect(screen.getByText(words.readOnly.title)).toBeTruthy()
    expect(screen.queryByLabelText(`${words.uploadPhoto}: Sandals`)).toBeNull()
    expect(screen.queryByRole('button', { name: words.addProduct })).toBeNull()
    expect(screen.queryByRole('button', { name: words.save })).toBeNull()
  })

  it('edits a product, adds one with an uploaded photo, and saves the whole sample with a reason', async () => {
    api.uploadSamplePhoto.mockResolvedValue({ ok: true, ref: 'sample-photo:' + 'b'.repeat(64), previewUrl: '/api/store-category-photos/c3/' + 'b'.repeat(64) })
    api.saveStoreCategorySampleItems.mockResolvedValue({ saved: true, problems: [] })
    await show('staff-super-admin')
    expect((screen.getByRole('button', { name: words.save }) as HTMLButtonElement).disabled).toBe(true)

    await click(screen.getByRole('button', { name: `${words.editProduct}: Runner` }))
    type(words.fields.price.replace('{currency}', 'INR'), '2199.50')
    await confirm(words.done)
    expect(screen.getByText('2199.50 INR')).toBeTruthy()

    await click(screen.getByRole('button', { name: words.addProduct }))
    type(words.fields.name, 'Loafer')
    type(words.fields.sku, 'FW-03')
    type(words.fields.price.replace('{currency}', 'INR'), '2999')
    const file = new File(['png'], 'loafer.png', { type: 'image/png' })
    await act(async () => fireEvent.change(inDialog().getByLabelText(words.addPhotos), { target: { files: [file] } }))
    expect(api.uploadSamplePhoto).toHaveBeenCalledWith('c3', file)
    await confirm(words.addProduct)
    expect(screen.getByText('Loafer')).toBeTruthy()

    await click(screen.getByRole('button', { name: words.save }))
    fireEvent.change(inDialog().getByLabelText(words.reason.label), { target: { value: 'Better prices' } })
    await confirm(words.save)
    const [categoryId, input, reason] = api.saveStoreCategorySampleItems.mock.calls[0] ?? []
    expect([categoryId, reason]).toEqual(['c3', 'Better prices'])
    expect(input.products).toHaveLength(3)
    expect(input.products[0]).toMatchObject({ name: 'Runner', price: '2199.50', photos: ['https://x/1.jpg'], collections: ['Sneakers'] })
    expect(input.products[2]).toMatchObject({ name: 'Loafer', sku: 'FW-03', price: '2999', stock: 10, photos: ['sample-photo:' + 'b'.repeat(64)], collections: ['Sneakers'] })
    expect(screen.getByText(fill(words.saved, { name: 'Footwear' }))).toBeTruthy()
  })

  it('adds several photos to a product at once, in order, and makes the last one its main photo', async () => {
    const answer = (c: string) => ({ ok: true, ref: 'sample-photo:' + c.repeat(64), previewUrl: '/api/store-category-photos/c3/' + c.repeat(64) })
    api.uploadSamplePhoto.mockResolvedValueOnce(answer('e')).mockResolvedValueOnce(answer('f'))
    api.saveStoreCategorySampleItems.mockResolvedValue({ saved: true, problems: [] })
    await show('staff-super-admin')

    await click(screen.getByRole('button', { name: `${words.editProduct}: Runner` }))
    const files = [new File(['1'], 'side.png', { type: 'image/png' }), new File(['2'], 'back.png', { type: 'image/png' })]
    await act(async () => fireEvent.change(inDialog().getByLabelText(words.addPhotos), { target: { files } }))
    expect(api.uploadSamplePhoto.mock.calls.map(([, f]) => f)).toEqual(files)
    const photo = (n: number) => fill(words.photoNumber, { number: String(n), name: 'Runner' })
    expect(inDialog().getAllByRole('img', { hidden: true }).map((i) => i.getAttribute('alt'))).toEqual([photo(1), photo(2), photo(3)])
    expect(inDialog().getByText(words.mainPhoto)).toBeTruthy()

    await click(inDialog().getByRole('button', { name: `${words.makeMain}: ${photo(3)}`, hidden: true }))
    await confirm(words.done)
    await click(screen.getByRole('button', { name: words.save }))
    fireEvent.change(inDialog().getByLabelText(words.reason.label), { target: { value: 'More photos' } })
    await confirm(words.save)
    const [, input] = api.saveStoreCategorySampleItems.mock.calls[0] ?? []
    expect(input.products[0].photos).toEqual(['sample-photo:' + 'f'.repeat(64), 'https://x/1.jpg', 'sample-photo:' + 'e'.repeat(64)])
  })

  it('uploads a collection’s photo, keeps one through a rename, removes another, and saves them by name', async () => {
    api.uploadSamplePhoto.mockResolvedValue({ ok: true, ref: 'sample-photo:' + 'd'.repeat(64), previewUrl: '/api/store-category-photos/c3/' + 'd'.repeat(64) })
    api.saveStoreCategorySampleItems.mockResolvedValue({ saved: true, problems: [] })
    await show('staff-super-admin')

    const file = new File(['png'], 'sandals.png', { type: 'image/png' })
    await act(async () => fireEvent.change(screen.getByLabelText(`${words.uploadPhoto}: Sandals`), { target: { files: [file] } }))
    expect(api.uploadSamplePhoto).toHaveBeenCalledWith('c3', file)
    expect((screen.getByAltText(fill(words.photoAlt, { name: 'Sandals' })) as HTMLImageElement).src).toContain('d'.repeat(64))

    await click(screen.getByRole('button', { name: `${words.renameCollection}: Sneakers` }))
    type(words.collectionName, 'Trainers')
    await confirm(words.renameCollection)
    expect(screen.getByAltText(fill(words.photoAlt, { name: 'Trainers' }))).toBeTruthy()

    await click(screen.getByRole('button', { name: `${words.removePhoto}: Sandals` }))
    expect(screen.queryByAltText(fill(words.photoAlt, { name: 'Sandals' }))).toBeNull()

    await click(screen.getByRole('button', { name: words.save }))
    fireEvent.change(inDialog().getByLabelText(words.reason.label), { target: { value: 'Collection photos' } })
    await confirm(words.save)
    const [, input] = api.saveStoreCategorySampleItems.mock.calls[0] ?? []
    expect(input.collections).toEqual(['Trainers', 'Sandals'])
    expect(input.collectionPhotos).toEqual([{ name: 'Trainers', photo: 'sample-photo:' + 'c'.repeat(64) }])
  })

  it('refuses a duplicate SKU in the form and lists the problems the check returns', async () => {
    api.saveStoreCategorySampleItems.mockResolvedValue({ saved: false, problems: [{ line: 3, column: 'price', code: 'BAD_PRICE', message: 'Price isn’t a number.' }] })
    await show('staff-super-admin')
    await click(screen.getByRole('button', { name: `${words.editProduct}: Sandal` }))
    type(words.fields.sku, 'FW-01')
    expect(inDialog().getByText(words.skuTaken)).toBeTruthy()
    expect((inDialog().getByRole('button', { name: words.done, hidden: true }) as HTMLButtonElement).disabled).toBe(true)
    type(words.fields.sku, 'FW-09')
    await confirm(words.done)
    await click(screen.getByRole('button', { name: words.save }))
    fireEvent.change(inDialog().getByLabelText(words.reason.label), { target: { value: 'New SKU' } })
    await confirm(words.save)
    expect(inDialog().getByText(words.refused)).toBeTruthy()
    expect(inDialog().getByText(/Price isn’t a number/)).toBeTruthy()
  })

  it('renames and deletes collections, following them into products, and blocks Save on an empty one', async () => {
    await show('staff-super-admin')
    await click(screen.getByRole('button', { name: `${words.renameCollection}: Sneakers` }))
    type(words.collectionName, 'Trainers')
    await confirm(words.renameCollection)
    expect(screen.getAllByText('Trainers').length).toBeGreaterThan(1)

    await click(screen.getByRole('button', { name: words.addCollection }))
    type(words.collectionName, 'Boots')
    await confirm(words.addCollection)
    expect(screen.getByText(fill(words.emptyCollection, { name: 'Boots' }))).toBeTruthy()
    expect((screen.getByRole('button', { name: words.save }) as HTMLButtonElement).disabled).toBe(true)

    await click(screen.getByRole('button', { name: `${words.dropCollection}: Boots` }))
    await confirm(words.dropCollection)
    await click(screen.getByRole('button', { name: `${words.dropProduct}: Sandal` }))
    await confirm(words.dropProduct)
    expect(screen.queryByText('Sandal')).toBeNull()
    expect((screen.getByRole('button', { name: words.save }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(fill(words.emptyCollection, { name: 'Sandals' }))).toBeTruthy()
  })

  it('starts an empty sample for Super admin: a collection first, then products', async () => {
    await show('staff-super-admin', null)
    expect(screen.getByText(words.noSample)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.addProduct }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(words.collectionFirst)).toBeTruthy()
  })

  it('names the photo refusal in plain words', async () => {
    api.uploadSamplePhoto.mockResolvedValue({ ok: false, code: 'PHOTO_REFUSED' })
    await show('staff-super-admin')
    await click(screen.getByRole('button', { name: `${words.editProduct}: Sandal` }))
    await act(async () => fireEvent.change(inDialog().getByLabelText(words.addPhotos), { target: { files: [new File(['x'], 'x.txt', { type: 'text/plain' })] } }))
    expect(inDialog().getByRole('alert').textContent).toBe(words.photoRefused.PHOTO_REFUSED)
  })
})

