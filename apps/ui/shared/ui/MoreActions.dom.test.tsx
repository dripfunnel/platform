// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MoreActions } from './MoreActions'

// happy-dom has no layout, so the button's and the panel's boxes are stubbed (#1651).
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const box = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) })

const openWith = (buttonTop: number, panelHeight: number, windowHeight: number) => {
  vi.stubGlobal('innerHeight', windowHeight)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('df-more-panel')) return box(buttonTop + 40, panelHeight) as DOMRect
    return box(buttonTop, 36) as DOMRect
  })
  render(<MoreActions label="Actions">{() => <button type="button">Edit</button>}</MoreActions>)
  fireEvent.click(screen.getByRole('button', { name: /Actions/ }))
  return document.querySelector('.df-more-panel')
}

describe('MoreActions', () => {
  it('opens below its button when the window has room there', () => {
    expect(openWith(100, 200, 800)?.classList.contains('df-more-panel--up')).toBe(false)
  })

  it('opens above its button when the window has no room below and has room above', () => {
    expect(openWith(700, 300, 800)?.classList.contains('df-more-panel--up')).toBe(true)
  })

  it('stays below when it fits neither way, so the top of the menu is never lost', () => {
    expect(openWith(100, 900, 800)?.classList.contains('df-more-panel--up')).toBe(false)
  })

  it('goes back below once closed, and decides again when opened next', () => {
    const panel = openWith(700, 300, 800)
    fireEvent.click(screen.getByRole('button', { name: /Actions/ }))
    expect(panel?.classList.contains('df-more-panel--up')).toBe(false)
  })
})
