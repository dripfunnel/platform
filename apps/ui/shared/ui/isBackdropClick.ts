import type { MouseEvent } from 'react'

// A click on a modal <dialog>'s ::backdrop targets the dialog itself, and so does one on the
// dialog's own padding, so only a click outside the dialog's box counts as the scrim.
export const isBackdropClick = (event: MouseEvent<HTMLDialogElement>): boolean => {
  if (event.target !== event.currentTarget) return false
  const box = event.currentTarget.getBoundingClientRect()
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
}
