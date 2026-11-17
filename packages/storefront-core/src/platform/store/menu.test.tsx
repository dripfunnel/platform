// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../../test/shop'
import { PrefilledProvider } from '../render/data'
import { useMenu } from './menu'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const Menu = () => <p>{useMenu().items.map((i) => `${i.label}>${i.href}[${i.children.map((c) => c.href).join()}]`).join(' ')}</p>

describe('useMenu', () => {
  it("links each item as its kind says, and leaves out one whose link doesn't resolve", async () => {
    shopAnswering(() => ({
      data: {
        menu: [
          { id: '1', label: 'Linen', kind: 'collection', collectionSlug: 'linen', url: null, children: [{ id: '2', label: 'About', kind: 'page', collectionSlug: null, url: '/about' }] },
          { id: '3', label: 'Hidden', kind: 'collection', collectionSlug: null, url: null, children: [] },
          { id: '4', label: 'Blog', kind: 'url', collectionSlug: null, url: 'https://blog.example' },
          { id: '5', label: 'Sneaky', kind: 'page', collectionSlug: null, url: '//elsewhere.example' },
          { id: '6', label: 'Backslash', kind: 'page', collectionSlug: null, url: '/\\elsewhere.example' },
          { id: '7', label: 'Tab', kind: 'page', collectionSlug: null, url: '/%09/elsewhere.example' },
          { id: '8', label: 'Control', kind: 'page', collectionSlug: null, url: '/\u0009/elsewhere.example' },
          { id: '9', label: 'Script', kind: 'url', collectionSlug: null, url: 'javascript:alert(1)' },
          { id: '10', label: 'Backslash host', kind: 'url', collectionSlug: null, url: 'https://a.example\\@evil.example' },
        ],
      },
    }))
    render(<Provided><Menu /></Provided>)
    expect((await screen.findByText(/Linen/)).textContent).toBe('Linen>/collections/linen/[/about] Blog>https://blog.example[]')
  })

  // #1481: a live page is built with the menu as it was at publish; asking again swapped its header after it had loaded.
  const built = [{ id: '1', label: 'Linen', kind: 'collection', collectionSlug: 'linen', url: null, children: [] }]
  const newer = { data: { menu: [{ id: '9', label: 'Newborn Essentials', kind: 'collection', collectionSlug: 'newborn', url: null, children: [] }] } }
  const asBuilt = (children: React.ReactNode) => (
    <Provided mode="live">
      <PrefilledProvider value={{ answers: new Map([['menu', items(built)]]) }}>{children}</PrefilledProvider>
    </Provided>
  )
  const items = (rows: typeof built) => rows.map((r) => ({ id: r.id, label: r.label, href: `/collections/${r.collectionSlug}/`, children: [] }))

  it('keeps the menu a live page was built with, and never asks the Shop API for another, so its header cannot change after load (#1481)', async () => {
    const asked = shopAnswering(() => newer)
    render(asBuilt(<Menu />))
    expect(screen.getByText(/Linen/).textContent).toBe('Linen>/collections/linen/[]')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(screen.getByText(/Linen/).textContent).toBe('Linen>/collections/linen/[]')
    expect(asked.filter((a) => a.query.includes('query Menu'))).toEqual([])
  })

  it('still loads the current menu where nothing was built with one: the preview and the studio (#1481)', async () => {
    const asked = shopAnswering(() => newer)
    render(<Provided><Menu /></Provided>)
    expect((await screen.findByText(/Newborn Essentials/)).textContent).toBe('Newborn Essentials>/collections/newborn/[]')
    expect(asked.filter((a) => a.query.includes('query Menu'))).toHaveLength(1)
  })
})
