import { describe, expect, it } from 'vitest'
import { opensRow } from './ClickableRow'

const click = { button: 0, defaultPrevented: false, onControl: false, selecting: false }

describe('opensRow', () => {
  it('opens the row on a plain left click anywhere in it', () => {
    expect(opensRow(click)).toBe(true)
  })

  it('leaves links and controls inside the row to do their own thing', () => {
    expect(opensRow({ ...click, onControl: true })).toBe(false)
  })

  it('lets text be selected and copied without leaving the page', () => {
    expect(opensRow({ ...click, selecting: true })).toBe(false)
  })

  it('ignores other buttons and clicks something else already handled', () => {
    expect(opensRow({ ...click, button: 1 })).toBe(false)
    expect(opensRow({ ...click, defaultPrevented: true })).toBe(false)
  })
})
