'use client'

import { useEffect } from 'react'
import { useStorefront } from '../store/context'

// The thin bar a live page shows while its built answers are asked again (ARCHITECTURE §2.1 "Loading, in both render modes", #1578).
// Core draws it, so every theme has it; the adopted sheet follows sizeChartDialog.tsx, since a theme may style nothing of it.
const bar = '[data-df-refresh]'
const css = `${bar}{position:fixed;top:0;left:0;right:0;height:3px;overflow:hidden;z-index:2147483000;pointer-events:none;background:color-mix(in srgb,var(--df-sealed-color,#1d1b18) 15%,transparent)}
${bar}::before{content:'';position:absolute;top:0;bottom:0;left:0;width:40%;background:var(--df-sealed-color,#1d1b18);animation:df-refresh 1.1s ease-in-out infinite}
@keyframes df-refresh{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){${bar}::before{width:100%;animation:none}}`
let sheet: CSSStyleSheet | null = null
const style = () => {
  if (sheet || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return
  sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
}

export const RefreshBar = ({ busy }: { busy: boolean }) => {
  const { t } = useStorefront()
  useEffect(() => {
    if (!busy) return
    style()
    document.body.setAttribute('aria-busy', 'true')
    return () => document.body.removeAttribute('aria-busy')
  }, [busy])
  return busy ? <div data-df-refresh="" role="progressbar" aria-label={t('refresh.checking')} /> : null
}
