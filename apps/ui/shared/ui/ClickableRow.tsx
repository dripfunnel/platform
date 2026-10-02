import type { MouseEvent, ReactNode } from 'react'
import './list.css'

export interface RowClick {
  button: number
  defaultPrevented: boolean
  onControl: boolean
  selecting: boolean
}

// A click opens the row unless it was meant for something else: another button, a link or
// control inside the row, or selecting text to copy.
export const opensRow = ({ button, defaultPrevented, onControl, selecting }: RowClick) =>
  button === 0 && !defaultPrevented && !onControl && !selecting

// The whole row opens its record, as the prototype's Customers rows do. The click is handed
// to the row's own title link, so the link stays the one keyboard and screen-reader target
// and the row adds no tab stop of its own; Ctrl or Cmd still open it in a new tab.
export const ClickableRow = ({ children }: { children: ReactNode }) => {
  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target instanceof Element ? event.target : null
    const click = {
      button: event.button,
      defaultPrevented: event.defaultPrevented,
      onControl: target?.closest('a, button, input, select, textarea, label, summary') !== null,
      selecting: (window.getSelection()?.toString() ?? '') !== '',
    }
    if (!opensRow(click)) return
    const link = event.currentTarget.querySelector<HTMLAnchorElement>('a.df-row-title')
    link?.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }),
    )
  }
  return (
    <tr className="df-row-clickable" onClick={onClick}>
      {children}
    </tr>
  )
}
