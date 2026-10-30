import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

// The studio's chat width: dragged or arrowed on the divider, kept for this browser only.

const key = 'df-studio-chat-width'
const min = 320
const hardMax = 760
/** The preview keeps at least this much, so the divider can never push it away. */
const previewMin = 360
const step = 24

const read = (): number | null => {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n >= min ? n : null
  } catch {
    return null
  }
}
const write = (width: number) => {
  try {
    localStorage.setItem(key, String(width))
  } catch {
    // A private window keeps the width for this visit only.
  }
}

export const useChatWidth = () => {
  const body = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(() => read() ?? 400)
  const [dragging, setDragging] = useState(false)
  const max = Math.max(min, Math.min(hardMax, (body.current?.clientWidth ?? hardMax + previewMin) - previewMin))
  const clamp = useCallback((value: number) => Math.round(Math.max(min, Math.min(Math.max(min, Math.min(hardMax, (body.current?.clientWidth ?? hardMax + previewMin) - previewMin)), value))), [])
  const set = useCallback((value: number) => setWidth(clamp(value)), [clamp])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !body.current) return
    set(event.clientX - body.current.getBoundingClientRect().left)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    write(width)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step : event.key === 'Home' ? min : event.key === 'End' ? max : null
    if (next === null) return
    event.preventDefault()
    const clamped = clamp(next)
    setWidth(clamped)
    write(clamped)
  }

  return { bodyRef: body, width, dragging, min, max, handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown, onDoubleClick: () => (setWidth(400), write(400)) } }
}
