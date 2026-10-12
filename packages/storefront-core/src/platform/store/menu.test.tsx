// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../../test/shop'
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
})
