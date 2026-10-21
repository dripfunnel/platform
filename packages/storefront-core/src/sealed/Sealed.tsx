'use client'

import { createElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { defineSealed, sealedRoot, sealedTag, type SealedPart } from './element'
import { watchVisibility } from './visibility'

defineSealed()

type SealedProps = {
  part: SealedPart
  /** The theme's class for the host: placement, and the custom properties the parts read. */
  className?: string | undefined
  /** False while a component is deliberately not showing, such as a consent banner already answered. */
  shown?: boolean
  /** Holds the banner's height in the page, since the banner itself sits in the top layer. */
  reserve?: boolean
  children?: ReactNode
}

/** Renders `children` in a closed shadow root only core holds; a theme reaches the host and its ::part names, nothing else (ARCHITECTURE §3.5). */
export const Sealed = ({ part, className, shown = true, reserve = false, children }: SealedProps) => {
  const host = useRef<HTMLElement>(null)
  const [root, setRoot] = useState<ShadowRoot | null>(null)
  useLayoutEffect(() => {
    if (host.current) setRoot(sealedRoot(host.current, part))
  }, [part])
  useEffect(() => (root && shown && host.current ? watchVisibility(host.current, part) : undefined), [root, shown, part])
  useEffect(() => {
    const el = host.current
    const banner = root?.querySelector<HTMLElement>('[popover]')
    if (!reserve || !el || !banner || typeof ResizeObserver !== 'function') return
    const sizes = new ResizeObserver(() => {
      el.style.minHeight = `${banner.offsetHeight}px`
    })
    sizes.observe(banner)
    return () => sizes.disconnect()
  }, [root, reserve, shown])
  return createElement(sealedTag, { ref: host, className, 'data-df-sealed': part, 'data-df-state': shown ? 'shown' : 'closed' }, root ? createPortal(children, root) : children)
}
