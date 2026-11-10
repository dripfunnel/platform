'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useStorefront } from '../../platform/store/context'
import { fractionDigits } from '../../pricing/money'
import type { PriceBounds, PriceChoice } from '../../products/listing'

// A listing's price filter (storefront ARCHITECTURE §2.1 `ui/headless`): a two-thumb slider over round prices with a
// lowest and highest choice under it. Core draws it, since a theme may write no <select>; the theme styles each part.

export type PriceRangeParts = Partial<Record<'track' | 'rail' | 'fill' | 'tick' | 'thumb' | 'ends' | 'select' | 'to', string>>

export type PriceRangeProps = {
  /** `listing.priceBounds`; draw nothing while it is null. */
  bounds: PriceBounds
  value: PriceChoice
  onChange: (range: PriceChoice) => void
  /** The group's name, such as the filter's heading. */
  label: string
  className?: string
  parts?: PriceRangeParts
}

const maxStops = 12

// The store's CSP refuses a style attribute in the built HTML (platform/csp), so positions are set on the element itself.
const placed = (style: Partial<CSSStyleDeclaration>) => (element: HTMLElement | null) => {
  if (element) Object.assign(element.style, style)
}
const niceSteps = [1n, 2n, 5n]

/** Thumbs by stop index. */
type Ends = { lo: number; hi: number }

/** The smallest of 1, 2 or 5 times a power of ten that spans `span` in `gaps` steps. */
const niceStep = (span: bigint, gaps: bigint): bigint => {
  for (let scale = 1n; ; scale *= 10n) {
    const step = niceSteps.map((m) => m * scale).find((s) => s * gaps >= span)
    if (step) return step
  }
}

/** Round prices from at or below the lowest to at or above the highest, 1, 2 or 5 times a power of ten apart. */
export const priceStops = (bounds: PriceBounds): bigint[] => {
  const unit = 10n ** BigInt(fractionDigits(bounds.min.currency))
  const lo = BigInt(bounds.min.amount)
  const hi = BigInt(bounds.max.amount)
  const size = niceStep((hi - lo) / unit, BigInt(maxStops - 2)) * unit
  const start = (lo / size) * size
  const end = hi % size === 0n && hi > start ? hi : (hi / size + 1n) * size
  const stops: bigint[] = []
  for (let at = start; at <= end; at += size) stops.push(at)
  return stops
}

const indexOf = (stops: bigint[], amount: string | null, open: number, below: boolean) => {
  if (amount === null) return open
  const at = BigInt(amount)
  const found = below ? stops.findLastIndex((s) => s <= at) : stops.findIndex((s) => s >= at)
  return found === -1 ? open : found
}

export const PriceRangeSlider = ({ bounds, value, onChange, label, className, parts = {} }: PriceRangeProps) => {
  const { t, locale } = useStorefront()
  const stops = priceStops(bounds)
  const last = stops.length - 1
  const unit = 10n ** BigInt(fractionDigits(bounds.min.currency))
  const chosen = { lo: indexOf(stops, value.min, 0, true), hi: indexOf(stops, value.max, last, false) }
  const [held, setHeld] = useState<Ends | null>(null)
  const shown = held ?? chosen
  const track = useRef<HTMLDivElement | null>(null)
  const dragging = useRef<keyof Ends | null>(null)
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(typing.current ?? undefined), [])

  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: bounds.min.currency, maximumFractionDigits: 0, minimumFractionDigits: 0 })
  const words = (i: number) => {
    const price = money.format(Number((stops[i] ?? 0n) / unit))
    return i === last ? t('priceRange.orMore', { price }) : price
  }
  const commit = (next: Ends) => {
    setHeld(null)
    if (next.lo === chosen.lo && next.hi === chosen.hi) return
    onChange({ min: next.lo === 0 ? null : `${stops[next.lo]}`, max: next.hi === last ? null : `${stops[next.hi]}` })
  }
  const place = (which: keyof Ends, i: number, from: Ends): Ends =>
    which === 'lo' ? { lo: Math.min(Math.max(i, 0), from.hi - 1), hi: from.hi } : { lo: from.lo, hi: Math.max(Math.min(i, last), from.lo + 1) }
  const stopAt = (x: number) => {
    const box = track.current?.getBoundingClientRect()
    return box && box.width > 0 ? Math.round(((x - box.left) / box.width) * last) : 0
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const i = stopAt(e.clientX)
    const which = Math.abs(i - shown.lo) <= Math.abs(i - shown.hi) ? 'lo' : 'hi'
    dragging.current = which
    e.currentTarget.setPointerCapture(e.pointerId)
    setHeld(place(which, i, shown))
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setHeld(place(dragging.current, stopAt(e.clientX), shown))
  }
  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = null
    commit(shown)
  }
  // Keys move a stop at a time and ask once the shopper pauses, so arrowing across asks the Shop API once.
  const onKeyDown = (which: keyof Ends) => (e: KeyboardEvent<HTMLSpanElement>) => {
    const by: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -3, PageUp: 3 }
    const at = which === 'lo' ? shown.lo : shown.hi
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? last : by[e.key] === undefined ? null : at + (by[e.key] ?? 0)
    if (to === null) return
    e.preventDefault()
    const next = place(which, to, shown)
    setHeld(next)
    clearTimeout(typing.current ?? undefined)
    typing.current = setTimeout(() => commit(next), 600)
  }
  const percent = (i: number) => `${(i / last) * 100}%`
  const thumb = (which: keyof Ends) => {
    const i = shown[which]
    return (
      <span
        role="slider"
        tabIndex={0}
        className={parts.thumb}
        aria-label={t(which === 'lo' ? 'priceRange.min' : 'priceRange.max')}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={i}
        aria-valuetext={which === 'lo' && i === 0 ? t('priceRange.any') : words(i)}
        ref={placed({ position: 'absolute', left: percent(i), transform: 'translateX(-50%)' })}
        onKeyDown={onKeyDown(which)}
      />
    )
  }
  const pick = (which: keyof Ends) => (e: { target: { value: string } }) => commit(place(which, Number(e.target.value), chosen))

  return (
    <div role="group" aria-label={label} className={className}>
      <div
        ref={(element) => {
          track.current = element
          placed({ position: 'relative', touchAction: 'none' })(element)
        }}
        className={parts.track}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <span className={parts.rail} />
        <span className={parts.fill} ref={placed({ position: 'absolute', left: percent(shown.lo), width: `${((shown.hi - shown.lo) / last) * 100}%` })} />
        {stops.map((s, i) => (
          <span key={`${s}`} className={parts.tick} ref={placed({ position: 'absolute', left: percent(i) })} aria-hidden="true" />
        ))}
        {thumb('lo')}
        {thumb('hi')}
      </div>
      <div className={parts.ends}>
        <select className={parts.select} aria-label={t('priceRange.min')} value={shown.lo} onChange={pick('lo')}>
          {stops.slice(0, last).map((s, i) => (
            <option key={`${s}`} value={i}>
              {i === 0 ? t('priceRange.any') : words(i)}
            </option>
          ))}
        </select>
        <span className={parts.to}>{t('priceRange.to')}</span>
        <select className={parts.select} aria-label={t('priceRange.max')} value={shown.hi} onChange={pick('hi')}>
          {stops.slice(1).map((s, i) => (
            <option key={`${s}`} value={i + 1}>
              {words(i + 1)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
