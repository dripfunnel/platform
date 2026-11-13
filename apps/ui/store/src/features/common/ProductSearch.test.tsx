// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fill, messages } from '../../messages'
import { ProductSearch } from './ProductSearch'

const api = vi.hoisted(() => ({ loadProducts: vi.fn() }))
vi.mock('../../api/products', async (actual) => ({ ...(await actual<typeof import('../../api/products')>()), ...api }))

const words = messages.productSearch
const pajama = { id: 'p1', name: 'Baby Cotton Pajama Set (2-Piece)' }
const bunny = { id: 'p2', name: 'Bunny Pajama Top' }

const Harness = () => {
  const [picked, setPicked] = useState<string[]>([])
  return (
    <>
      <ProductSearch label="Search products" hide={picked} onPick={(p) => setPicked((now) => [...now, p.id])} />
      <output data-testid="picked">{picked.join(',')}</output>
    </>
  )
}
const box = () => screen.getByRole('searchbox', { name: 'Search products' }) as HTMLInputElement
const search = (text: string) => fireEvent.change(box(), { target: { value: text } })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the product search (#1471)', () => {
  it('clears the box after a pick, says nothing is missing, and keeps the cursor in it', async () => {
    api.loadProducts.mockResolvedValue({ rows: [pajama] })
    render(<Harness />)
    search('Pajama')
    fireEvent.click(await screen.findByRole('button', { name: /Baby Cotton Pajama/ }))
    expect(screen.getByTestId('picked').textContent).toBe('p1')
    expect(box().value).toBe('')
    expect(document.activeElement).toBe(box())
    expect(screen.queryByText(fill(words.none, { query: 'Pajama' }))).toBeNull()
    expect(screen.queryByText(/No products match/)).toBeNull()
  })

  it('searches again after a pick, leaving out what was picked', async () => {
    api.loadProducts.mockResolvedValueOnce({ rows: [pajama] }).mockResolvedValueOnce({ rows: [pajama, bunny] })
    render(<Harness />)
    search('Pajama')
    fireEvent.click(await screen.findByRole('button', { name: /Baby Cotton/ }))
    search('Pajama')
    expect(await screen.findByRole('button', { name: /Bunny Pajama Top/ })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: /Baby Cotton/ })).toBeNull())
    expect(box().value).toBe('Pajama')
  })

  it('still says nothing matches for a search that finds nothing', async () => {
    api.loadProducts.mockResolvedValue({ rows: [] })
    render(<Harness />)
    search('zzz')
    expect(await screen.findByText(fill(words.none, { query: 'zzz' }))).toBeTruthy()
  })
})
