'use client'

import { useEffect, useRef, useState } from 'react'
import { Link, useReducedMotion } from '@dripfunnel/storefront-core/theme'
import { cx } from '../cx'
import art from '../../styles/art.module.css'
import styles from '../../styles/hero.module.css'

const autoplayMs = 4500
const swipePx = 40

export type HeroSlide = {
  key: string
  href: string
  /** What the artwork says, for screen readers: the banner's words are part of the picture. */
  label: string
  /** The class that paints this slide's banner (art.module.css), over a gradient while it loads. */
  art: string | undefined
}

type HeroLabels = { region: string; role: string; previous: string; next: string; goTo: (n: number) => string }

export const HeroCarousel = ({ slides, labels }: { slides: HeroSlide[]; labels: HeroLabels }) => {
  const [selected, setSelected] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduced = useReducedMotion()
  const swipeFrom = useRef<number | null>(null)
  const count = slides.length
  const go = (index: number) => setSelected((index + count) % count)
  // Slides before the current one wait off to the left, those after it off to the right.
  const place = (index: number) => (index === selected ? styles.current : index < selected ? styles.before : styles.after)

  // One timer per slide: keying on `selected` gives every slide the full interval after any change.
  useEffect(() => {
    if (paused || count < 2) return
    const id = setTimeout(() => setSelected((i) => (i + 1) % count), autoplayMs)
    return () => clearTimeout(id)
  }, [paused, selected, count])

  return (
    <section
      className={styles.hero}
      aria-roledescription={labels.role}
      aria-label={labels.region}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onPointerDown={(e) => {
        swipeFrom.current = e.clientX
      }}
      onPointerUp={(e) => {
        if (swipeFrom.current === null) return
        const dx = e.clientX - swipeFrom.current
        swipeFrom.current = null
        if (Math.abs(dx) > swipePx) go(selected + (dx < 0 ? 1 : -1))
      }}
    >
      <div className={styles.track}>
        {slides.map((slide, index) => (
          <div key={slide.key} className={cx(styles.slide, place(index), reduced && styles.still)}>
            <Link href={slide.href} className={cx(styles.slideLink, art.art, slide.art)}>
              <span className={styles.hidden}>{slide.label}</span>
            </Link>
          </div>
        ))}
      </div>
      {count > 1 ? (
        <>
          <button type="button" className={cx(styles.arrow, styles.previous)} aria-label={labels.previous} onClick={() => go(selected - 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button type="button" className={cx(styles.arrow, styles.next)} aria-label={labels.next} onClick={() => go(selected + 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <div className={styles.dots}>
            {slides.map((slide, index) => (
              <button key={slide.key} type="button" className={cx(styles.dot, index === selected && styles.dotOn)} aria-label={labels.goTo(index + 1)} aria-current={index === selected} onClick={() => go(index)} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
