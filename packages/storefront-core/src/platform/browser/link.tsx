'use client'

import type { ReactNode } from 'react'
import { useStorefront } from '../store/context'

/** A path on this store or an http(s) address; never `javascript:`, `data:`, `//host`, or a backslash or control character a browser would read as `/` or drop. */
const safe = (href: string): boolean =>
  ![...href].some((c) => c === '\\' || c <= ' ' || c === '\u007f' || /\s/.test(c)) && (/^[/?#]/.test(href) ? !href.startsWith('//') : /^https?:\/\//i.test(href))

// Decided from the address alone, so the server's HTML and the browser's render agree: this store's links are paths.
const elsewhere = (href: string): boolean => /^https?:\/\//i.test(href)

/**
 * The only link a theme renders (ARCHITECTURE §3.4). In the studio frame a link to another host opens a
 * new tab and carries nothing from the frame (§3.5, AI-STUDIO §8).
 */
export const Link = ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => {
  const { mode } = useStorefront()
  if (!safe(href)) return <span className={className}>{children}</span>
  const away = mode === 'studio' && elsewhere(href)
  return (
    <a href={href} className={className} {...(away ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
      {children}
    </a>
  )
}
