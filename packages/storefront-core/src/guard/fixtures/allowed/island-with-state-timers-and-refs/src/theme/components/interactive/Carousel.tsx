'use client'

import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { useStorefront } from '@dripfunnel/storefront-core/theme'
import styles from '../../styles/page.module.css'

const slides = [0, 1, 2]

export const Carousel = () => {
  const { t } = useStorefront()
  const [index, setIndex] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % slides.length), 4000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const el = track.current
    if (!el) return
    el.style.transform = `translateX(${-index * 100}%)`
    el.style.setProperty('--progress', String(index / slides.length))
    const width = el.getBoundingClientRect().width
    el.classList.toggle(styles.lead ?? '', width > Math.max(0, 320))
  }, [index])
  const onKey = (e: { key: string; currentTarget: HTMLElement }) => {
    if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, slides.length - 1))
    e.currentTarget.focus()
  }
  return (
    <div className={clsx(styles.lead, index > 0 && styles.body)} role="region" aria-roledescription={t('pages.home.more')} aria-live="polite" tabIndex={0} onKeyDown={onKey}>
      <div ref={track} className={styles['body']} data-index={index}>
        {slides.map((slide) => (
          <div key={slide} aria-hidden={slide !== index}>
            {t('pages.home.story')}
          </div>
        ))}
      </div>
      <button type="button" aria-label={t('pages.home.more')} disabled={index === 0} onClick={() => setIndex(0)}>
        <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true" focusable="false">
          <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth={2} />
        </svg>
      </button>
    </div>
  )
}
