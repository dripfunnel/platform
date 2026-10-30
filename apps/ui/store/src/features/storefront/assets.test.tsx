// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryAsset } from '../../api/assetLibrary'
import { messages } from '../../messages'
import { AssetsTab } from './AssetsTab'

// Storefront › Assets (PortalStorefront; storefront AI-STUDIO §8): the store's own files, upload, rename, delete.

const words = messages.storefront.assets
const asset = (id: string, name: string | null, uses = 0): LibraryAsset => ({ id, kind: 'image', mime: 'image/png', bytes: 250_000, width: 1200, height: 900, name, uses, createdAt: '2026-10-29T10:00:00Z' })
const fakeApi = () => ({
  loadLibrary: vi.fn().mockResolvedValue({ assets: [asset('a1', 'Hero photo', 1), asset('a2', null)], next: null }),
  uploadAsset: vi.fn().mockResolvedValue({ ok: true, asset: { id: 'a3', kind: 'image', mime: 'image/png', bytes: 1 } }),
  renameLibraryAsset: vi.fn().mockResolvedValue(undefined),
  deleteLibraryAsset: vi.fn().mockResolvedValue(undefined),
})
let api: ReturnType<typeof fakeApi>
const onToast = vi.fn()
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const show = async (canEdit = true) => {
  await act(async () => void render(<AssetsTab api={api} canEdit={canEdit} onToast={onToast} />))
  await settle()
}

beforeEach(() => {
  api = fakeApi()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  onToast.mockClear()
})

describe('the Assets tab', () => {
  it('lists the files with their use, and offers Delete only for a file nothing uses', async () => {
    await show()
    expect(screen.getByText('Hero photo')).toBeTruthy()
    expect(screen.getByText(words.used)).toBeTruthy()
    expect(screen.getByText(words.unused)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: words.delete })).toHaveLength(1)
  })

  it('shows no change controls to a Manager', async () => {
    await show(false)
    expect(screen.queryByRole('button', { name: words.upload })).toBeNull()
    expect(screen.queryByRole('button', { name: words.rename })).toBeNull()
    expect(screen.queryByRole('button', { name: words.delete })).toBeNull()
  })

  it('says when there are no files, and when none match a search', async () => {
    api.loadLibrary.mockResolvedValue({ assets: [], next: null })
    await show()
    expect(screen.getByText(words.empty)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(words.search), { target: { value: 'zzz' } })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(api.loadLibrary).toHaveBeenLastCalledWith({ after: null, kind: null, search: 'zzz' })
    expect(screen.getByText(words.emptySearch)).toBeTruthy()
  })

  it('says it couldn’t load, and reads again on Try again', async () => {
    api.loadLibrary.mockRejectedValueOnce(new Error('offline'))
    await show()
    expect(screen.getByRole('alert').textContent).toContain(words.failed)
    fireEvent.click(screen.getByRole('button', { name: words.retry }))
    await settle()
    expect(screen.getByText('Hero photo')).toBeTruthy()
  })

  it('uploads a picked image and reads the list again, and refuses a file of another kind', async () => {
    await show()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const png = new File(['x'], 'a.png', { type: 'image/png' })
    await act(async () => void fireEvent.change(input, { target: { files: [png] } }))
    await settle()
    expect(api.uploadAsset).toHaveBeenCalledWith(png)
    expect(api.loadLibrary).toHaveBeenCalledTimes(2)
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await act(async () => void fireEvent.change(input, { target: { files: [pdf] } }))
    await settle()
    expect(api.uploadAsset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toBe(words.uploadRefused.UNSUPPORTED_TYPE)
  })

  it('renames a file', async () => {
    await show()
    fireEvent.click(screen.getAllByRole('button', { name: words.rename })[1] as HTMLElement)
    fireEvent.change(screen.getByLabelText(words.renameLabel), { target: { value: 'Studio' } })
    fireEvent.click(screen.getByRole('button', { name: words.save }))
    await settle()
    expect(api.renameLibraryAsset).toHaveBeenCalledWith('a2', 'Studio')
    expect(screen.getByText('Studio')).toBeTruthy()
  })

  it('asks before deleting, then removes the file; a refusal for a file now in use says so', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: words.delete }))
    expect(screen.getByText(words.deleteConsequence)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.deleteConfirm }))
    await settle()
    expect(api.deleteLibraryAsset).toHaveBeenCalledWith('a2')
    expect(onToast).toHaveBeenCalledWith(words.deleted)
    cleanup()
    api = fakeApi()
    api.deleteLibraryAsset.mockRejectedValueOnce(new ApiError('ASSET_IN_USE', 'No.'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: words.delete }))
    fireEvent.click(screen.getByRole('button', { name: words.deleteConfirm }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(words.inUse)
  })
})
