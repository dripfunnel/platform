'use client'

import type { MouseEvent, ReactNode, Ref } from 'react'
import { useOptionalStorefront, useStorefront } from '../store/context'
import { navigate } from './router'

/** A path on this store, an http(s) address, or `tel:` and a dialable number; never `javascript:`, `data:`, `//host`, or a backslash or control character a browser would read as `/` or drop. */
const safe = (href: string): boolean =>
  ![...href].some((c) => c === '\\' || c <= ' ' || c === '\u007f' || /\s/.test(c)) && (/^[/?#]/.test(href) ? !href.startsWith('//') : /^https?:\/\//i.test(href) || /^tel:\+?\d{6,15}$/i.test(href))

// Decided from the address alone, so the server's HTML and the browser's render agree: this store's links are paths.
const elsewhere = (href: string): boolean => /^https?:\/\//i.test(href)

/**
 * In the studio frame, a click on a store path through navigate(), which keeps the frame's `/__studio/{session}/`
 * path a plain anchor would leave (AI-STUDIO §8); undefined elsewhere, and for modified clicks the browser keeps.
 */
export const useStayInFrame = (href: string): ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined => {
  const mode = useOptionalStorefront()?.mode
  if (mode !== 'studio' || !href.startsWith('/') || href.startsWith('//')) return undefined
  return (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(href)
  }
}

/**
 * The only link a theme renders (ARCHITECTURE §3.4). In the studio frame a link to another host opens a
 * new tab and carries nothing from the frame (§3.5, AI-STUDIO §8). `ref` lets a theme move focus to it.
 */
export const Link = ({ href, className, children, ref }: { href: string; className?: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => {
  const { mode } = useStorefront()
  const stay = useStayInFrame(href)
  if (!safe(href)) return <span className={className}>{children}</span>
  const away = mode === 'studio' && elsewhere(href)
  return (
    <a ref={ref} href={href} className={className} onClick={stay} {...(away ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
      {children}
    </a>
  )
}
