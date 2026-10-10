'use client'

import type { ReactNode } from 'react'
import { useStorefront } from '../store/context'

/** An address a link may carry: a path on this store, or an http(s) address; never `javascript:` or `data:`. */
const safe = (href: string): boolean => /^[/?#]/.test(href) ? !href.startsWith('//') : /^https?:\/\//i.test(href)

const elsewhere = (href: string): boolean => {
  const here = globalThis.location
  return here !== undefined && new URL(href, here.href).origin !== here.origin
}

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
