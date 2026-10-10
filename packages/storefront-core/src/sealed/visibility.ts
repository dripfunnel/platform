import { rootOf, type SealedPart } from './element'
import { reportProblem } from './report'

export type VisibilityProblem = 'hidden' | 'transparent' | 'too-small' | 'off-screen' | 'covered'

/** The smallest box, in CSS pixels, each sealed component may render at (ARCHITECTURE §3.5). */
export const minimumSize: Record<SealedPart, { width: number; height: number }> = {
  price: { width: 24, height: 12 },
  preview: { width: 200, height: 24 },
  powered: { width: 40, height: 12 },
  legal: { width: 120, height: 24 },
  consent: { width: 240, height: 80 },
  'consent-settings': { width: 24, height: 24 },
  breadcrumbs: { width: 40, height: 12 },
}

/** Below this, a part or the text in it counts as transparent. */
export const minimumOpacity = 0.5

/** How long a failing check waits before it is checked again and reported, so an entrance animation can finish. */
export const settleMs = 1000

const parentOf = (el: Element): Element | null => el.parentElement ?? (el.parentNode instanceof ShadowRoot ? el.parentNode.host : null)

const alphaOf = (color: string): number => {
  if (color === 'transparent') return 0
  const inner = /\(([^)]*)\)/.exec(color)?.[1]
  if (!inner) return 1
  const raw = inner.includes('/') ? inner.split('/')[1] : inner.split(',')[3]
  if (raw === undefined) return 1
  const value = parseFloat(raw)
  return raw.trim().endsWith('%') ? value / 100 : value
}

/** A banner's box is its popover in the top layer; any other component's is its host. */
const boxOf = (host: HTMLElement, root: ShadowRoot): HTMLElement => root.querySelector<HTMLElement>('[popover]') ?? host

const scrolls = (style: CSSStyleDeclaration) => /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)

/** Why a sealed component isn't seen, or null when it is: shown, opaque, its minimum size, on the page and uncovered at its centre. */
export const visibilityProblem = (host: HTMLElement, part: SealedPart, { layout }: { layout: boolean }): VisibilityProblem | null => {
  const root = rootOf(host)
  const view = host.ownerDocument.defaultView
  if (!root || !view || !host.isConnected) return 'hidden'
  const box = boxOf(host, root)
  const topLayer = box !== host
  let opacity = 1
  let reachable = false
  for (let el: Element | null = box; el; el = parentOf(el)) {
    const style = view.getComputedStyle(el)
    if (style.display === 'none' || style.contentVisibility === 'hidden') return 'hidden'
    // The top layer escapes its ancestors' opacity and clipping, though not display: none.
    if (!topLayer || el.getRootNode() === root) opacity *= Number(style.opacity || '1')
    if (el !== box && scrolls(style)) reachable = true
  }
  if (['hidden', 'collapse'].includes(view.getComputedStyle(box).visibility)) return 'hidden'
  if (opacity < minimumOpacity) return 'transparent'
  for (const el of root.querySelectorAll('[part]')) {
    if (el.textContent?.trim() && alphaOf(view.getComputedStyle(el).color) < minimumOpacity) return 'transparent'
  }
  if (!layout) return null

  const rect = box.getBoundingClientRect()
  const min = minimumSize[part]
  if (rect.width < min.width || rect.height < min.height) return 'too-small'
  const page = host.ownerDocument.documentElement
  const left = rect.left + view.scrollX
  const top = rect.top + view.scrollY
  if (!reachable && (left < -1 || top + rect.height <= 0 || left + rect.width > page.scrollWidth + 1)) return 'off-screen'
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) return null
  const hit = host.ownerDocument.elementFromPoint(x, y)
  return hit === null || hit === host || host.contains(hit) ? null : 'covered'
}

/** Checks a sealed component after layout and whenever it scrolls into view, and reports what still fails a moment later. */
export const watchVisibility = (host: HTMLElement, part: SealedPart): (() => void) => {
  const view = host.ownerDocument.defaultView
  const root = rootOf(host)
  if (!view || !root) return () => undefined
  const timers = new Set<number>()
  const check = () => {
    if (visibilityProblem(host, part, { layout: true }) === null) return
    const timer = view.setTimeout(() => {
      timers.delete(timer)
      const problem = visibilityProblem(host, part, { layout: true })
      if (problem) reportProblem({ kind: 'sealed', subject: part, detail: problem })
    }, settleMs)
    timers.add(timer)
  }
  let frame = view.requestAnimationFrame(() => {
    frame = view.requestAnimationFrame(check)
  })
  const seen = typeof view.IntersectionObserver === 'function' ? new view.IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && check()) : null
  seen?.observe(boxOf(host, root))
  return () => {
    view.cancelAnimationFrame(frame)
    timers.forEach((t) => view.clearTimeout(t))
    seen?.disconnect()
  }
}
