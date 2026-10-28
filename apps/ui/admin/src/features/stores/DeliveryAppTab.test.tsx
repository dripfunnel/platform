// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeliveryApp } from '../../api/deliveryApp'
import type { Store } from '../../api/stores'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import { messages } from '../../messages'
import { DeliveryAppTab } from './DeliveryAppTab'

// The Delivery app tab (card #852; api/DELIVERY.md §5): the live version, an upload with a reason, and the minimum build.

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const words = messages.store.deliveryApp
const store = (): Store => {
  const found = createStoresServer(sampleStores, () => '2026-09-30T00:00:00Z').get('s13', 'staff-super-admin')
  if (!found) throw new Error('No sample store s13')
  return found
}
const live: DeliveryApp = { version: 1, versionName: '1.0.0', buildNumber: 3, sizeBytes: 31_457_280, minimumBuild: null, uploadedAt: '2026-10-28T10:00:00Z' }
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

const stubFetch = (...answers: unknown[]) => {
  const fetchMock = vi.fn()
  for (const answer of answers) fetchMock.mockResolvedValueOnce(json(answer))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const shown = async (canChange = true, onToast = vi.fn()) => {
  await act(async () => {
    render(<DeliveryAppTab store={store()} canChange={canChange} onToast={onToast} />)
  })
  return onToast
}

describe('the delivery app tab', () => {
  it('says there is no app yet, and offers the first upload', async () => {
    stubFetch({ ok: true, current: null })
    await shown()
    expect(screen.getByText(words.none)).toBeTruthy()
    expect(screen.getByRole('heading', { name: words.uploadTitle })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: words.minimumTitle })).toBeNull()
  })

  it('shows the live version, its size and the minimum build', async () => {
    stubFetch({ ok: true, current: { ...live, minimumBuild: 2 } })
    await shown()
    expect(screen.getByText('1.0.0 (build 3)')).toBeTruthy()
    expect(screen.getByText('30 MB')).toBeTruthy()
    expect((screen.getByRole('textbox', { name: words.minimumBuild }) as HTMLInputElement).value).toBe('2')
  })

  it('uploads the file with its version, build and reason in the query, then shows the new version', async () => {
    const fetchMock = stubFetch({ ok: true, current: live }, { ok: true, current: { ...live, version: 2, versionName: '1.1.0', buildNumber: 4 } })
    const onToast = await shown()
    const upload = screen.getByRole('button', { name: words.upload }) as HTMLButtonElement
    expect(upload.disabled).toBe(true)
    const apk = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'app.apk')
    fireEvent.change(screen.getByLabelText(words.file), { target: { files: [apk] } })
    fireEvent.change(screen.getByLabelText(words.versionName), { target: { value: '1.1.0' } })
    fireEvent.change(screen.getByLabelText(words.buildNumber), { target: { value: '4' } })
    fireEvent.change(screen.getAllByLabelText(words.reason)[0] as HTMLElement, { target: { value: 'Fixes the map’s crash' } })
    expect(upload.disabled).toBe(false)
    await act(async () => fireEvent.click(upload))
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    const parsed = new URL(url, 'https://admin.dripfunnel.ai')
    expect(parsed.pathname).toBe(`/api/stores/${store().id}/delivery-app`)
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ versionName: '1.1.0', buildNumber: '4' })
    expect(init).toMatchObject({ method: 'POST', body: apk, headers: { 'x-reason': encodeURIComponent('Fixes the map’s crash'), 'x-reason-encoding': 'uri' } })
    expect(screen.getByText('1.1.0 (build 4)')).toBeTruthy()
    expect(onToast).toHaveBeenCalledWith('Delivery app 1.1.0 uploaded.')
  })

  it('says why a refused upload was refused, and keeps what was typed', async () => {
    stubFetch({ ok: true, current: live }, { ok: false, code: 'BUILD_NOT_NEWER' })
    await shown()
    fireEvent.change(screen.getByLabelText(words.file), { target: { files: [new File(['x'], 'app.apk')] } })
    fireEvent.change(screen.getByLabelText(words.versionName), { target: { value: '1.0.0' } })
    fireEvent.change(screen.getByLabelText(words.buildNumber), { target: { value: '3' } })
    fireEvent.change(screen.getAllByLabelText(words.reason)[0] as HTMLElement, { target: { value: 'Again' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: words.upload })))
    expect(screen.getByRole('alert').textContent).toBe(words.refusals.BUILD_NOT_NEWER)
    expect((screen.getByLabelText(words.versionName) as HTMLInputElement).value).toBe('1.0.0')
  })

  it('sets the minimum build with a reason, and removes it when emptied', async () => {
    const fetchMock = stubFetch({ ok: true, current: live }, { ok: true, current: { ...live, minimumBuild: 3 } })
    await shown()
    const save = screen.getByRole('button', { name: words.saveMinimum }) as HTMLButtonElement
    fireEvent.change(screen.getByRole('textbox', { name: words.minimumBuild }), { target: { value: '3' } })
    fireEvent.change(screen.getAllByLabelText(words.reason)[1] as HTMLElement, { target: { value: 'The API needs build 3' } })
    expect(save.disabled).toBe(false)
    await act(async () => fireEvent.click(save))
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(`/api/stores/${store().id}/delivery-app/minimum-build`)
    expect(JSON.parse(String(init.body))).toEqual({ minimumBuild: 3, reason: 'The API needs build 3' })
  })

  it('removes the minimum when the field is emptied, and keeps Save off while it equals the current one', async () => {
    const fetchMock = stubFetch({ ok: true, current: { ...live, minimumBuild: 2 } }, { ok: true, current: live })
    await shown()
    const save = screen.getByRole('button', { name: words.saveMinimum }) as HTMLButtonElement
    fireEvent.change(screen.getAllByLabelText(words.reason)[1] as HTMLElement, { target: { value: 'No longer needed' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: words.minimumBuild }), { target: { value: '' } })
    expect(save.disabled).toBe(false)
    await act(async () => fireEvent.click(save))
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ minimumBuild: null, reason: 'No longer needed' })
  })

  it('turns every control off for a role that may not change it, and says so', async () => {
    stubFetch({ ok: true, current: live })
    await shown(false)
    expect(screen.getByText(words.readOnly)).toBeTruthy()
    expect((screen.getByLabelText(words.file) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: words.upload }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a load error with a retry when the API does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await shown()
    expect(screen.getByText(words.error.title)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.error.retry })).toBeTruthy()
  })
})
