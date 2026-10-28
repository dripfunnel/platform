// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { MobileAppAssets } from '../../api/mobileApps'
import type { Acting } from '../../api/shell'
import { fill, formatCount, messages } from '../../messages'

// Settings › Mobile apps driven as the Owner would (SH 15, #868).

const w = messages.settings.mobileApps

const api = vi.hoisted(() => ({
  loadMobileApps: vi.fn(),
  saveMobileApps: vi.fn(),
  uploadAppFile: vi.fn(),
  loadRiderPlan: vi.fn(),
}))
vi.mock('../../api/mobileApps', async (actual) => ({ ...(await actual<typeof import('../../api/mobileApps')>()), loadMobileApps: api.loadMobileApps, saveMobileApps: api.saveMobileApps, uploadAppFile: api.uploadAppFile }))
vi.mock('../../api/riders', async (actual) => ({ ...(await actual<typeof import('../../api/riders')>()), loadRiderPlan: api.loadRiderPlan }))
vi.mock('../../api/settings', () => ({ loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: null, permissions: ['catalog.read', 'settings'] }
const manager: Acting = { ...owner, role: 'manager', permissions: ['catalog.read'] }

const saved = (over: Partial<MobileAppAssets> = {}): MobileAppAssets => ({
  version: 3,
  appIcon: 'stores/s1/app/appIcon-1.png',
  appIconForeground: null,
  splash: null,
  appName: 'Kesari',
  shortDescription: 'Handwoven sarees',
  longDescription: null,
  savedAt: '2026-10-20T09:30:00Z',
  ...over,
})

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (readOnly = false, acting: Acting = owner) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const settings = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'mobile-apps'])) }), component: SettingsPage })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([settings])]), history: createMemoryHistory({ initialEntries: ['/settings?tab=mobile-apps'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: w.save }) as HTMLButtonElement
const picker = (file: string) => screen.getByLabelText(fill(w.pick, { file })) as HTMLInputElement
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const choose = (file: string, picked: File) => fireEvent.change(picker(file), { target: { files: [picked] } })
const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'icon.png', { type: 'image/png' })

beforeEach(() => {
  // The previews read their picture back by key; here there is none to read.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
  api.loadRiderPlan.mockResolvedValue({ ownDelivery: false, ownApps: true })
  api.loadMobileApps.mockResolvedValue({ available: true, current: saved() })
  api.saveMobileApps.mockResolvedValue(saved({ version: 4, appName: 'Kesari Threads' }))
  api.uploadAppFile.mockResolvedValue({ ok: true, key: 'stores/s1/app/appIconForeground-9.png' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('the Mobile apps tab', () => {
  it('is listed for a plan with own_apps, and not for one without', async () => {
    await show()
    expect(document.querySelector('a[href*="tab=mobile-apps"]')).not.toBeNull()
    cleanup()
    api.loadRiderPlan.mockResolvedValue({ ownDelivery: true, ownApps: false })
    await show()
    expect(document.querySelector('a[href*="tab=mobile-apps"]')).toBeNull()
  })

  it('says so, with no form, when the plan reads as without apps', async () => {
    api.loadMobileApps.mockResolvedValue({ available: false, current: null })
    await show()
    expect(screen.getByText(w.notAvailable.title)).toBeTruthy()
    expect(screen.queryByRole('button', { name: w.save })).toBeNull()
  })

  it('is the Owner’s: a manager is told it is not theirs', async () => {
    await show(false, manager)
    expect(screen.getByText(messages.settings.denied.title)).toBeTruthy()
    expect(api.loadMobileApps).not.toHaveBeenCalled()
  })

  it('shows the saved version with its words, the rules of each image and the counters', async () => {
    await show()
    expect(field(w.appName).value).toBe('Kesari')
    expect(screen.getByText(fill(w.counter, { count: formatCount(6), max: formatCount(30) }))).toBeTruthy()
    expect(screen.getByText(fill(w.counter, { count: formatCount(16), max: formatCount(80) }))).toBeTruthy()
    expect(screen.getByText(fill(w.counter, { count: formatCount(0), max: formatCount(4000) }))).toBeTruthy()
    expect(screen.getByText(w.rules.appIcon)).toBeTruthy()
    expect(screen.getByText(/Version 3, saved/)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('shows the empty state of a store that has saved nothing', async () => {
    api.loadMobileApps.mockResolvedValue({ available: true, current: null })
    await show()
    expect(screen.getByText(w.noVersion)).toBeTruthy()
    expect(screen.getAllByText(w.none)).toHaveLength(3)
  })

  it('counts as typed, stops at each limit, and saves only once something changed', async () => {
    await show()
    type(w.appName, 'Kesari Threads')
    expect(screen.getByText(fill(w.counter, { count: formatCount(14), max: formatCount(30) }))).toBeTruthy()
    expect(field(w.appName).maxLength).toBe(30)
    expect(field(w.shortDescription).maxLength).toBe(80)
    expect((screen.getByLabelText(w.longDescription) as HTMLTextAreaElement).maxLength).toBe(4000)
    expect(saveButton().disabled).toBe(false)
    type(w.appName, 'Kesari')
    expect(saveButton().disabled).toBe(true)
  })

  it('saves what was typed and the keys the uploads answered, then shows the new version', async () => {
    await show()
    type(w.appName, 'Kesari Threads')
    await act(async () => void choose(w.files.appIconForeground, png()))
    await settle()
    expect(api.uploadAppFile).toHaveBeenCalledWith('appIconForeground', expect.any(File))
    fireEvent.click(saveButton())
    await settle()
    expect(api.saveMobileApps).toHaveBeenCalledWith({ appIcon: 'stores/s1/app/appIcon-1.png', appIconForeground: 'stores/s1/app/appIconForeground-9.png', splash: null, appName: 'Kesari Threads', shortDescription: 'Handwoven sarees', longDescription: '' })
    expect(screen.getByText(fill(w.saved, { version: '4' }))).toBeTruthy()
    expect(screen.getByText(/Version 4, saved/)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('words each refusal of a save by its code, and keeps what was typed', async () => {
    for (const code of ['INVALID_INPUT', 'UNKNOWN_FILE', 'PLAN_LIMIT', 'FORBIDDEN'] as const) {
      api.saveMobileApps.mockRejectedValueOnce(new ApiError(code, 'refused'))
      await show()
      type(w.appName, 'Changed')
      fireEvent.click(saveButton())
      await settle()
      expect(screen.getByRole('alert').textContent, code).toBe(w.refused[code])
      expect(field(w.appName).value).toBe('Changed')
      cleanup()
    }
  })

  it('words each refusal of an image by the rule it broke, and does not change the draft', async () => {
    for (const code of ['WRONG_DIMENSIONS', 'HAS_TRANSPARENCY', 'NOT_PNG', 'TOO_LARGE'] as const) {
      api.uploadAppFile.mockResolvedValueOnce({ ok: false, code })
      await show()
      await act(async () => void choose(w.files.appIcon, png()))
      await settle()
      expect(screen.getByRole('alert').textContent, code).toBe(w.uploadRefused[code])
      expect(saveButton().disabled).toBe(true)
      cleanup()
    }
  })

  it('refuses a file over 512 KB before sending it', async () => {
    await show()
    await act(async () => void choose(w.files.splash, png(600 * 1024)))
    expect(api.uploadAppFile).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(w.uploadRefused.TOO_LARGE)
  })

  it('removes an image from the draft, which is then saved as none', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: fill(w.removeLabel, { file: w.files.appIcon }) }))
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await settle()
    expect(api.saveMobileApps).toHaveBeenCalledWith(expect.objectContaining({ appIcon: null }))
  })

  it('is look-only when the store is read-only: no upload, no remove, no save, and the text can’t be typed in', async () => {
    await show(true)
    expect(screen.queryByRole('button', { name: w.save })).toBeNull()
    expect(screen.queryByLabelText(fill(w.pick, { file: w.files.appIcon }))).toBeNull()
    expect(screen.queryByRole('button', { name: fill(w.removeLabel, { file: w.files.appIcon }) })).toBeNull()
    expect(field(w.appName).readOnly).toBe(true)
  })

  it('shows the tab’s error with a retry when its reads fail', async () => {
    api.loadMobileApps.mockRejectedValueOnce(new Error('down'))
    await show()
    expect(screen.getByText(messages.settings.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: messages.settings.error.retry }))
    await settle()
    expect(field(w.appName).value).toBe('Kesari')
  })
})
