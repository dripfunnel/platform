import type { KeyboardEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { tabKeyHandler } from './tabKeys'

const press = (key: string, current: string, held: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => {
  const choose = vi.fn()
  const event = { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...held, preventDefault: vi.fn() } as unknown as KeyboardEvent
  tabKeyHandler(['a', 'b', 'c'], current, choose, () => undefined)(event)
  return choose.mock.calls[0]?.[0]
}

describe('tab keys', () => {
  it('moves with the arrows, wrapping, and to the ends with Home and End', () => {
    expect(press('ArrowRight', 'a')).toBe('b')
    expect(press('ArrowRight', 'c')).toBe('a')
    expect(press('ArrowLeft', 'a')).toBe('c')
    expect(press('Home', 'b')).toBe('a')
    expect(press('End', 'a')).toBe('c')
  })

  it('leaves every other key alone', () => {
    expect(press('Enter', 'a')).toBeUndefined()
  })

  it('leaves a key with a modifier to the browser: Alt+Left is Back, Ctrl+End scrolls', () => {
    expect(press('ArrowLeft', 'b', { altKey: true })).toBeUndefined()
    expect(press('End', 'a', { ctrlKey: true })).toBeUndefined()
    expect(press('Home', 'c', { metaKey: true })).toBeUndefined()
    expect(press('ArrowRight', 'a', { shiftKey: true })).toBeUndefined()
  })
})
