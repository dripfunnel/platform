import type { MouseEvent } from 'react'
import { describe, expect, it } from 'vitest'
import { isBackdropClick } from './isBackdropClick'

const dialog = { getBoundingClientRect: () => ({ left: 0, right: 280, top: 0, bottom: 720 }) }
const click = (clientX: number, clientY: number, target: object = dialog) =>
  ({ target, currentTarget: dialog, clientX, clientY }) as unknown as MouseEvent<HTMLDialogElement>

describe('isBackdropClick', () => {
  it('counts a click outside the dialog box as the scrim', () => {
    expect(isBackdropClick(click(300, 100))).toBe(true)
  })

  it('ignores a click on the dialog’s own empty space', () => {
    expect(isBackdropClick(click(200, 20))).toBe(false)
  })

  it('ignores a click on something inside the dialog', () => {
    expect(isBackdropClick(click(300, 100, {}))).toBe(false)
  })
})
