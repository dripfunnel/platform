// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../api/stock'
import { fill as fillWords, messages } from '../../messages'

// A supplier's Warehouses tab (#337): its own locations, added, made default, edited and deleted as SetOps draws them.

const words = messages.warehouses

const api = vi.hoisted(() => ({ loadPlaces: vi.fn(), savePlace: vi.fn(), makeDefaultPlace: vi.fn(), deletePlace: vi.fn() }))
vi.mock('../../api/stock', async (actual) => ({ ...(await actual<typeof import('../../api/stock')>()), ...api }))

const { WarehousesView, placeInputOf } = await import('./WarehousesView')

const place = (p: Partial<Place> & Pick<Place, 'id' | 'name'>): Place => ({ isDefault: false, units: 0, revision: 1, supplierId: null, address: { line1: '12 High St', line2: null, city: 'Moradabad', region: 'UP', postalCode: '244001', country: 'IN' }, ...p })

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

const show = async (canEdit = true, side: 'merchant' | 'supplier' = 'supplier') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => <WarehousesView canEdit={canEdit} side={side} /> }), history: createMemoryHistory({ initialEntries: ['/products/warehouses'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
}

const dialog = () => within(document.querySelector('dialog') as HTMLElement)

beforeEach(() => {
  // A supplier's own locations carry its seller id, as the API answers them (inventory.ts supplierId).
  api.loadPlaces.mockResolvedValue([place({ id: 'w2', name: 'Back room', units: 4, supplierId: 'sup-1' }), place({ id: 'w1', name: 'Workshop', isDefault: true, units: 30, supplierId: 'sup-1' })])
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('a supplier’s locations', () => {
  it('sends the name and only the address lines given, the country in capitals', () => {
    expect(placeInputOf({ id: null, revision: null, name: ' Shed ', line1: '', line2: '', city: 'Jaipur', region: '', postalCode: '', country: 'in' })).toEqual({ name: 'Shed', address: { city: 'Jaipur', country: 'IN' } })
  })

  it('on the merchant side, lists a supplier’s location apart with nothing to manage', async () => {
    api.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Store room', isDefault: true }), place({ id: 'w9', name: 'Northwind depot', supplierId: 'sup-1' })])
    await show(true, 'merchant')
    expect(screen.getByRole('button', { name: fillWords(words.manage, { name: 'Store room' }) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: fillWords(words.manage, { name: 'Northwind depot' }) })).toBeNull()
    expect(screen.getByRole('heading', { name: words.theirsTitle })).toBeTruthy()
    expect(screen.getByText('Northwind depot')).toBeTruthy()
  })

  it('lists the default first, with each location’s units', async () => {
    await show()
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual(['Workshop', 'Back room'])
    expect(within(rows[0] as HTMLElement).getByText(words.default)).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText(/4 units/)).toBeTruthy()
  })

  it('adds a location with its address', async () => {
    api.savePlace.mockResolvedValue('w3')
    await show()
    fireEvent.click(screen.getByRole('button', { name: words.add }))
    fireEvent.change(screen.getByLabelText(words.form.name), { target: { value: 'Shed' } })
    fireEvent.change(screen.getByLabelText(words.form.city), { target: { value: 'Jaipur' } })
    fireEvent.click(screen.getByRole('button', { name: words.form.saveAdd }))
    await settle()
    expect(api.savePlace).toHaveBeenCalledWith(null, null, { name: 'Shed', address: { city: 'Jaipur' } })
    expect(screen.getByText('Shed added')).toBeTruthy()
  })

  it('makes another location the default, and refuses to delete one that still holds stock', async () => {
    api.makeDefaultPlace.mockResolvedValue(undefined)
    await show()
    fireEvent.click(screen.getByRole('button', { name: fill('Back room') }))
    fireEvent.click(dialog().getByRole('button', { name: messages.editor.apply }))
    await settle()
    expect(api.makeDefaultPlace).toHaveBeenCalledWith('w2')
    fireEvent.click(screen.getByRole('button', { name: fill('Back room') }))
    fireEvent.change(dialog().getByRole('combobox'), { target: { value: 'delete' } })
    fireEvent.click(dialog().getByRole('button', { name: messages.editor.apply }))
    await settle()
    expect(screen.getByText('Back room still holds 4 units — set their stock to 0 or move them, then delete')).toBeTruthy()
    expect(api.deletePlace).not.toHaveBeenCalled()
  })

  it('deletes an empty location after confirming, and words the API’s refusals', async () => {
    api.loadPlaces.mockResolvedValue([place({ id: 'w1', name: 'Workshop', isDefault: true }), place({ id: 'w2', name: 'Back room' })])
    api.deletePlace.mockRejectedValueOnce(new ApiError('WAREHOUSE_HOLDS_STOCK', 'stock'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: fill('Back room') }))
    fireEvent.change(dialog().getByRole('combobox'), { target: { value: 'delete' } })
    fireEvent.click(dialog().getByRole('button', { name: messages.editor.apply }))
    fireEvent.click(dialog().getByRole('button', { name: words.deleteConfirm }))
    await settle()
    expect(api.deletePlace).toHaveBeenCalledWith('w2')
    expect(screen.getByText(words.refused.WAREHOUSE_HOLDS_STOCK)).toBeTruthy()
  })

  it('edits a location at the revision it was read, and closes the form with their change when someone saved first', async () => {
    let stored = 1
    api.savePlace.mockImplementation(async (id: string, revision: number) => {
      if (revision !== stored) throw new ApiError('STALE_REVISION', 'stale')
      stored += 1
      return id
    })
    await show()
    stored = 2
    fireEvent.click(screen.getByRole('button', { name: fill('Workshop') }))
    fireEvent.click(dialog().getByRole('button', { name: messages.editor.apply }))
    expect((screen.getByLabelText(words.form.city) as HTMLInputElement).value).toBe('Moradabad')
    fireEvent.change(screen.getByLabelText(words.form.name), { target: { value: 'Main workshop' } })
    api.loadPlaces.mockResolvedValue([place({ id: 'w2', name: 'Back room', units: 4 }), place({ id: 'w1', name: 'Workshop HQ', isDefault: true, units: 30, revision: 2 })])
    fireEvent.click(screen.getByRole('button', { name: words.form.save }))
    await settle()
    expect(api.savePlace).toHaveBeenCalledWith('w1', 1, { name: 'Main workshop', address: { line1: '12 High St', city: 'Moradabad', region: 'UP', postalCode: '244001', country: 'IN' } })
    expect(screen.getByText(words.refused.STALE_REVISION)).toBeTruthy()
    expect(screen.queryByLabelText(words.form.name)).toBeNull()
    // Opened again, it edits their change at its new revision, and saves.
    fireEvent.click(screen.getByRole('button', { name: fill('Workshop HQ') }))
    fireEvent.click(dialog().getByRole('button', { name: messages.editor.apply }))
    fireEvent.click(screen.getByRole('button', { name: words.form.save }))
    await settle()
    expect(api.savePlace).toHaveBeenLastCalledWith('w1', 2, expect.objectContaining({ name: 'Workshop HQ' }))
    expect(screen.getByText(words.saved)).toBeTruthy()
  })

  it('words a refused add and a refused default', async () => {
    api.savePlace.mockRejectedValue(new ApiError('TOO_MANY_WAREHOUSES', 'limit'))
    api.makeDefaultPlace.mockRejectedValue(new ApiError('READ_ONLY', 'read only'))
    await show()
    fireEvent.click(screen.getByRole('button', { name: words.add }))
    fireEvent.change(screen.getByLabelText(words.form.name), { target: { value: 'Shed' } })
    fireEvent.click(screen.getByRole('button', { name: words.form.saveAdd }))
    await settle()
    expect(screen.getByText(words.refused.TOO_MANY_WAREHOUSES)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.form.cancel }))
    fireEvent.click(screen.getByRole('button', { name: fill('Back room') }))
    fireEvent.click(dialog().getByRole('button', { name: messages.editor.apply }))
    await settle()
    expect(screen.getByText(words.refused.READ_ONLY)).toBeTruthy()
  })

  it('blocks Save on a country that isn’t two letters, and says why to a screen reader', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: words.add }))
    fireEvent.change(screen.getByLabelText(words.form.name), { target: { value: 'Shed' } })
    const country = screen.getByLabelText(words.form.country)
    expect(country.getAttribute('aria-describedby')).toBeNull()
    fireEvent.change(country, { target: { value: 'U1' } })
    fireEvent.click(screen.getByRole('button', { name: words.form.saveAdd }))
    expect(api.savePlace).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(country)
    expect(country.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(country.getAttribute('aria-describedby') ?? '')?.textContent).toBe(words.form.countryInvalid)
  })

  it('words the manage dialog for the choice picked', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: fill('Back room') }))
    expect(dialog().getByText(words.makeDefaultBody)).toBeTruthy()
    fireEvent.change(dialog().getByRole('combobox'), { target: { value: 'edit' } })
    expect(dialog().getByText(words.editNext)).toBeTruthy()
    expect(dialog().queryByText(words.makeDefaultBody)).toBeNull()
    fireEvent.change(dialog().getByRole('combobox'), { target: { value: 'delete' } })
    expect(dialog().getByText(words.deleteNext)).toBeTruthy()
  })

  it('moves focus to the form when it opens, and says a name is needed when Save is tried without one', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: words.add }))
    const name = screen.getByLabelText(words.form.name)
    expect(document.activeElement).toBe(name)
    // Not said before Save is tried: an empty new form isn't a mistake yet.
    expect(screen.queryByText(words.form.nameMissing)).toBeNull()
    fireEvent.change(name, { target: { value: '  ' } })
    screen.getByRole('button', { name: words.form.cancel }).focus()
    fireEvent.click(screen.getByRole('button', { name: words.form.saveAdd }))
    expect(api.savePlace).not.toHaveBeenCalled()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby') ?? '')?.textContent).toBe(words.form.nameMissing)
    expect(document.activeElement).toBe(name)
    fireEvent.click(screen.getByRole('button', { name: words.form.cancel }))
    fireEvent.click(screen.getByRole('button', { name: fill('Workshop') }))
    fireEvent.click(dialog().getByRole('button', { name: messages.editor.apply }))
    expect(document.activeElement).toBe(screen.getByLabelText(words.form.name))
    expect((document.activeElement as HTMLInputElement).value).toBe('Workshop')
  })

  it('offers no delete for the default location', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: fill('Workshop') }))
    const options = within(dialog().getByRole('combobox')).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(['edit'])
  })

  it('shows loading, then an error with a retry that loads again, and an empty list', async () => {
    let fail: (e: Error) => void = () => undefined
    api.loadPlaces.mockReturnValueOnce(new Promise((_, reject) => (fail = reject))).mockResolvedValueOnce([])
    await show()
    expect(screen.getByText(words.loading)).toBeTruthy()
    await act(async () => fail(new Error('offline')))
    await settle()
    expect(screen.getByText(words.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.error.retry }))
    await settle()
    expect(api.loadPlaces).toHaveBeenCalledTimes(2)
    expect(screen.getByText(words.empty)).toBeTruthy()
  })

  it('shows the locations without a way to change them to a seat that can’t', async () => {
    await show(false)
    expect(screen.getByText(words.viewOnly)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.add })).toBeNull()
    expect(screen.queryByRole('button', { name: fill('Workshop') })).toBeNull()
  })
})

function fill(name: string) {
  return words.manage.replace('{name}', name)
}
