// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { later, Provided, shopAnswering } from '../../../test/shop'
import { Checkbox, SearchField, Select } from './fields'

afterEach(cleanup)

describe('the headless fields', () => {
  it('hands the search words over on submit, without posting the page', () => {
    const onSearch = vi.fn()
    render(<SearchField label="Search" button="Go" value="" onSearch={onSearch} />)
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'linen shirt' } })
    const submitted = fireEvent.submit(screen.getByRole('search'))
    expect(onSearch).toHaveBeenCalledWith('linen shirt')
    expect(submitted).toBe(false)
  })

  it('reports a choice and a tick', () => {
    const onSort = vi.fn()
    const onTick = vi.fn()
    render(
      <>
        <Select label="Sort" value="featured" options={[{ value: 'featured', label: 'Featured' }, { value: 'name', label: 'Name' }]} onChange={onSort} />
        <Checkbox checked={false} onChange={onTick}>
          Linen
        </Checkbox>
      </>,
    )
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'name' } })
    fireEvent.click(screen.getByLabelText('Linen'))
    expect(onSort).toHaveBeenCalledWith('name')
    expect(onTick).toHaveBeenCalledWith(true)
  })
})

describe('search suggestions', () => {
  afterEach(() => vi.unstubAllGlobals())

  const product = (n: number) => ({ id: `p${n}`, name: `Brass bell ${n}`, slug: `bell-${n}`, productType: 'physical', inStock: true, price: { amount: `${45000 * n}`, currency: 'USD' }, compareAt: null, maxPrice: null, photo: null, badges: [] })
  const answering = (count: number | 'fail') =>
    shopAnswering((asked) => (count === 'fail' ? { errors: [{ message: 'down', extensions: { code: 'INTERNAL' } }] } : { data: { products: { nodes: Array.from({ length: Math.min(count, Number(asked.variables.first)) }, (_, i) => product(i + 1)) } } }))
  const Field = ({ onSearch = vi.fn() }: { onSearch?: (words: string) => void }) => (
    <Provided>
      <SearchField label="Search" button="Go" value="" onSearch={onSearch} suggest={3} />
    </Provided>
  )
  const type = (words: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value: words } })

  it('asks once typing pauses, and nothing under two letters', async () => {
    const asked = answering(5)
    render(<Field />)
    type('b')
    await new Promise((r) => setTimeout(r, 400))
    expect(asked).toHaveLength(0)
    type('br')
    type('bra')
    type('brass')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4))
    expect(asked).toHaveLength(1)
    expect(asked[0]?.variables).toEqual({ search: 'brass', first: 3 })
  })

  it('lists the products with their sealed price and links, then all the results', async () => {
    answering(5)
    const onSearch = vi.fn()
    render(<Field onSearch={onSearch} />)
    type('brass')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4))
    const [first] = screen.getAllByRole('option')
    expect(first?.textContent).toContain('Brass bell 1')
    expect(first?.querySelector('a')?.getAttribute('href')).toBe('/products/bell-1/')
    expect(first?.querySelector('df-sealed')).not.toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'See all results for “brass”' }))
    expect(onSearch).toHaveBeenCalledWith('brass')
  })

  it('moves by arrow keys, opens all the results with Enter, and closes with Escape', async () => {
    answering(2)
    const onSearch = vi.fn()
    render(<Field onSearch={onSearch} />)
    type('brass')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    const box = screen.getByRole('combobox')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id)
    fireEvent.keyDown(box, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[2]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSearch).toHaveBeenCalledWith('brass')
    type('brasss')
    type('brass')
    await waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('true'))
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the highlighted product with Enter', async () => {
    answering(2)
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    render(<Field />)
    type('brass')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    const box = screen.getByRole('combobox')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(assign).toHaveBeenCalledWith('/products/bell-1/')
    assign.mockRestore()
  })

  it('never lets an older answer arriving late replace a newer one', async () => {
    const answers = { bra: later<unknown>(), brass: later<unknown>() }
    shopAnswering((asked) => answers[asked.variables.search as keyof typeof answers].promise)
    render(<Field />)
    type('bra')
    await new Promise((r) => setTimeout(r, 400))
    type('brass')
    await new Promise((r) => setTimeout(r, 400))
    answers.brass.settle({ data: { products: { nodes: [{ ...product(1), name: 'Brass bowl' }] } } })
    await waitFor(() => expect(screen.getAllByRole('option')[0]?.textContent).toContain('Brass bowl'))
    answers.bra.settle({ data: { products: { nodes: [{ ...product(2), name: 'Bracelet' }] } } })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getAllByRole('option')[0]?.textContent).toContain('Brass bowl')
  })

  it('says when nothing matches', async () => {
    answering(0)
    render(<Field />)
    type('zzz')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No products match “zzz”.'))
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false')
  })

  it('hides the list when the lookup fails, and the search still runs', async () => {
    const asked = answering('fail')
    const onSearch = vi.fn()
    render(<Field onSearch={onSearch} />)
    type('brass')
    await waitFor(() => expect(asked.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('')
    fireEvent.submit(screen.getByRole('search'))
    expect(onSearch).toHaveBeenCalledWith('brass')
  })

  it('leaves a search box without suggestions as it was', () => {
    render(<SearchField label="Search" button="Go" value="" onSearch={vi.fn()} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('listbox', { hidden: true })).toBeNull()
  })
})
