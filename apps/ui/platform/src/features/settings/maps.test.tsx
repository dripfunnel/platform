// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { senderOf } from '@dripfunnel/shared/messaging'
import { fill, messages } from '../../messages'
import { hooksHostFor } from './hooksHost'
import { MapsPanel } from './MapsPanel'

const words = messages.settings.integrations.maps
const secret = `AIza${'b'.repeat(31)}Zx9q`
const key = (o: object = {}) => ({ hint: 'AIza…Zx9q', status: 'ok', lastTestedAt: '2026-11-19T09:00:00Z', ...o })
type Status = { key: object | null; dripfunnel?: boolean; choice?: string | null }
const none: Status = { key: null }
// The API's answer, whose key draws by its own rule: DripFunnel's only where it's there and chosen, or nothing else works.
const answerOf = (s: Status) => ({ dripfunnel: false, choice: null, ...s, sender: senderOf(s.choice ?? null, (s.key as { status?: string } | null)?.status === 'ok', s.dripfunnel ?? false) })
const ok = { ok: true, reason: null, status: 'ok', problem: null }

const sent: string[] = []
let status: Status | 'fail' = none
let answers: Record<string, object | Promise<Response>> = {}
beforeEach(() => {
  sent.length = 0
  status = none
  answers = {}
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = String(init.body)
    sent.push(body)
    const mutation = ['saveMapsKey', 'testMapsKey', 'removeMapsKey', 'setMapsChoice'].find((m) => body.includes(m))
    if (mutation) {
      const answer = answers[mutation] ?? ok
      return answer instanceof Promise ? answer : Promise.resolve(new Response(JSON.stringify({ data: { [mutation]: answer } })))
    }
    return status === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(new Response(JSON.stringify({ data: { mapsKey: answerOf(status) } })))
  })
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('hooksHostFor', () => {
  it('swaps the console’s label for hooks, in every environment', () => {
    expect(hooksHostFor('platform.dripfunnel.ai')).toBe('hooks.dripfunnel.ai')
    expect(hooksHostFor('platform.dripfunnel.dev')).toBe('hooks.dripfunnel.dev')
    expect(hooksHostFor('Feature-1-platform.dripfunnel.dev')).toBe('feature-1-hooks.dripfunnel.dev')
    expect(hooksHostFor('platform.localhost')).toBe('hooks.localhost')
    expect(hooksHostFor('localhost')).toBe('hooks.localhost')
  })
})

describe('Google Maps on Integrations', () => {
  it('with no key says maps and address search are off, and offers to set one up', async () => {
    render(<MapsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText(words.none)).toBeTruthy()
    expect(screen.getByText(words.noMap)).toBeTruthy()
    expect(screen.getByText(words.off)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.setUp })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.test })).toBeNull()
    expect(screen.queryByText(words.sender.label)).toBeNull()
  })

  it('holds back a key not in Google’s shape, saves one that is, and shows it only as AIza…abcd', async () => {
    const toast = vi.fn()
    render(<MapsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await userEvent.type(screen.getByLabelText(words.keyLabel), 'AIza-short')
    expect(screen.getByText(words.dialog.incomplete)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.dialog.save }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.clear(screen.getByLabelText(words.keyLabel))
    await userEvent.type(screen.getByLabelText(words.keyLabel), secret)
    status = { key: key() }
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.saved))
    expect(JSON.parse(sent.find((b) => b.includes('saveMapsKey')) ?? '').variables).toEqual({ key: secret })
    expect(await screen.findByText('AIza…Zx9q')).toBeTruthy()
    expect(screen.queryByText(secret)).toBeNull()
    expect(screen.getByText(words.statuses.ok)).toBeTruthy()
    expect(screen.getByText(words.on)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.replace })).toBeTruthy()
  })

  it('names what Google refused on save and keeps the dialog open', async () => {
    answers.saveMapsKey = { ok: false, reason: 'KEY_REJECTED', status: null, problem: 'geocoding_disabled' }
    render(<MapsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await userEvent.type(screen.getByLabelText(words.keyLabel), secret)
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect(await screen.findByText(words.problems.geocoding_disabled)).toBeTruthy()
    answers.saveMapsKey = { ok: false, reason: 'PROVIDER_UNAVAILABLE', status: null, problem: null }
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect(await screen.findByText(words.refusals.PROVIDER_UNAVAILABLE)).toBeTruthy()
  })

  it('shows saving: the confirm waits for the answer', async () => {
    answers.saveMapsKey = new Promise<Response>(() => undefined)
    render(<MapsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await userEvent.type(screen.getByLabelText(words.keyLabel), secret)
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect((screen.getByRole('button', { name: words.dialog.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('tests the key: Working, or what Google rejected and that no map is drawn', async () => {
    status = { key: key() }
    const toast = vi.fn()
    render(<MapsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.test }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.ok))
    let release: (r: Response) => void = () => undefined
    answers.testMapsKey = new Promise<Response>((resolve) => (release = resolve))
    await userEvent.click(screen.getByRole('button', { name: words.test }))
    expect(screen.getByRole('button', { name: words.testing })).toBeTruthy()
    status = { key: key({ status: 'rejected' }) }
    release(new Response(JSON.stringify({ data: { testMapsKey: { ok: true, reason: null, status: 'rejected', problem: 'restricted' } } })))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.rejected))
    expect(await screen.findByText(words.problems.restricted)).toBeTruthy()
    expect(screen.getByText(words.statuses.rejected)).toBeTruthy()
    expect(screen.getByText(words.off)).toBeTruthy()
    expect(screen.getByText(words.noMap)).toBeTruthy()
  })

  it('removes the key after restating that the stores show no map, and says when it had gone already', async () => {
    status = { key: key() }
    const toast = vi.fn()
    render(<MapsPanel mayChange blocked={null} onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.remove }))
    expect(screen.getByText(words.removeDialog.consequence)).toBeTruthy()
    answers.removeMapsKey = { ok: false, reason: 'NOT_FOUND', status: null, problem: null }
    await userEvent.click(screen.getByRole('button', { name: words.removeDialog.confirm }))
    expect(await screen.findByText(words.refusals.NOT_FOUND)).toBeTruthy()
    answers.removeMapsKey = ok
    status = none
    await userEvent.click(screen.getByRole('button', { name: words.removeDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.removed))
    expect(await screen.findByText(words.none)).toBeTruthy()
  })

  it('offers DripFunnel’s key only where Admin switched it on, and saves the choice', async () => {
    status = { key: key(), dripfunnel: false }
    const { unmount } = render(<MapsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await screen.findByText('AIza…Zx9q')
    expect(screen.queryByRole('button', { name: words.choiceDialog.change })).toBeNull()
    expect(screen.queryByText(words.available)).toBeNull()
    unmount()
    status = { key: key(), dripfunnel: true, choice: 'own' }
    const toast = vi.fn()
    render(<MapsPanel mayChange blocked={null} onToast={toast} />)
    expect(await screen.findByText(words.sender.own)).toBeTruthy()
    expect(screen.getByText(words.available)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: words.choiceDialog.change }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(words.choiceDialog.ownHint)).toBeTruthy()
    await userEvent.click(within(dialog).getByLabelText(new RegExp(words.choiceDialog.ours)))
    expect(within(dialog).getByText(words.choiceDialog.consequenceOurs)).toBeTruthy()
    status = { key: key(), dripfunnel: true, choice: 'dripfunnel' }
    await userEvent.click(within(dialog).getByRole('button', { name: words.choiceDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.chosenOurs))
    expect(JSON.parse(sent.find((b) => b.includes('setMapsChoice')) ?? '').variables).toEqual({ account: 'dripfunnel' })
    expect(await screen.findByText(words.sender.ours)).toBeTruthy()
  })

  it('says DripFunnel’s key draws the maps while the partner has none of its own, and what removing says then', async () => {
    status = { key: null, dripfunnel: true }
    render(<MapsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText(words.noneOurs)).toBeTruthy()
    expect(screen.getByText(words.sender.ours)).toBeTruthy()
    expect(screen.getByText(words.on)).toBeTruthy()
    expect(screen.queryByText(words.noMap)).toBeNull()
  })

  it('shows the instructions: three APIs, this environment’s hooks host, the API restriction and the roles', async () => {
    render(<MapsPanel mayChange blocked={null} onToast={vi.fn()} />)
    await screen.findByText(words.none)
    const how = screen.getByText(words.how.title).closest('details')
    expect(how).toBeTruthy()
    for (const api of ['Maps JavaScript API', 'Geocoding API', 'Places API (New)']) expect(within(how as HTMLElement).getByText(new RegExp(api.replace(/[()]/g, '\\$&')))).toBeTruthy()
    expect(within(how as HTMLElement).getByText(fill(words.how.websites, { referrer: `https://${hooksHostFor(window.location.hostname)}/*` }))).toBeTruthy()
    expect(within(how as HTMLElement).getByText(words.how.restrictApis)).toBeTruthy()
    expect(within(how as HTMLElement).getByText(words.how.roles)).toBeTruthy()
    expect(within(how as HTMLElement).getAllByRole('link').length).toBe(words.how.links.length)
  })

  it('is read-only for a console that can’t change: the key shows, no buttons', async () => {
    status = { key: key(), dripfunnel: true }
    render(<MapsPanel mayChange={false} blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText('AIza…Zx9q')).toBeTruthy()
    for (const name of [words.replace, words.test, words.remove, words.choiceDialog.change]) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('in an impersonation shows the setup button disabled with the reason, and never asks the API', async () => {
    const reason = fill(words.blocked, { user: 'Asha' })
    render(<MapsPanel mayChange blocked={reason} onToast={vi.fn()} />)
    expect(await screen.findByText(reason)).toBeTruthy()
    expect((screen.getByRole('button', { name: words.setUp }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it('says it couldn’t load, and tries again', async () => {
    status = 'fail'
    render(<MapsPanel mayChange blocked={null} onToast={vi.fn()} />)
    expect(await screen.findByText(words.error.title)).toBeTruthy()
    status = none
    await userEvent.click(screen.getByRole('button', { name: words.error.retry }))
    expect(await screen.findByText(words.none)).toBeTruthy()
  })
})
