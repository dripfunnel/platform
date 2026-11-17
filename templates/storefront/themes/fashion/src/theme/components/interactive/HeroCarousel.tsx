'use client'

import { useEffect, useState } from 'react'
import { Link, ThemeImage, useReducedMotion, useStorefront } from '@dripfunnel/storefront-core/theme'
import { home, hero as styles } from '../styles/home'

const Arrow = ({ back = false, className }: { back?: boolean; className: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={back ? 'M19 12H5 M11 6l-6 6 6 6' : 'M5 12h14 M13 6l6 6-6 6'} />
  </svg>
)

/** The home page's three looks; it turns every 6 s unless the shopper prefers less motion or is using it. */
export const HeroCarousel = () => {
  const { t } = useStorefront()
  const still = useReducedMotion()
  const [shown, setShown] = useState(0)
  const [paused, setPaused] = useState(false)
  // A shopper's pause, or their own pick of a slide, stops the turning for good (WCAG 2.2.2).
  const [stopped, setStopped] = useState(false)
  const count = 3
  const show = (n: number) => {
    setStopped(true)
    setShown(n)
  }

  useEffect(() => {
    if (still || paused || stopped) return
    const timer = setInterval(() => setShown((n) => (n + 1) % count), 6000)
    return () => clearInterval(timer)
  }, [still, paused, stopped])

  const copy = [
    <div key="one" className={styles.copy}>
      <div className={styles.copyInner}>
      <p className={home.eyebrowLight}>{t('home.hero.slides.one.eyebrow')}</p>
      <h1 className={home.heroTitle}>
        {t('home.hero.slides.one.title')} <em className={styles.em}>{t('home.hero.slides.one.accent')}</em>
      </h1>
      <Link href="/collections/all/?sort=newest" className={home.button}>
        {t('home.hero.slides.one.action')} <Arrow className={home.arrow} />
      </Link>
      </div>
    </div>,
    <div key="two" className={styles.copy}>
      <div className={styles.copyInner}>
      <p className={home.eyebrowLight}>{t('home.hero.slides.two.eyebrow')}</p>
      <p className={home.heroTitle}>
        {t('home.hero.slides.two.title')} <em className={styles.em}>{t('home.hero.slides.two.accent')}</em>
      </p>
      <Link href="/collections/all/" className={home.button}>
        {t('home.hero.slides.two.action')} <Arrow className={home.arrow} />
      </Link>
      </div>
    </div>,
    <div key="three" className={styles.copy}>
      <div className={styles.copyInner}>
      <p className={home.eyebrowLight}>{t('home.hero.slides.three.eyebrow')}</p>
      <p className={home.heroTitle}>
        {t('home.hero.slides.three.title')} <em className={styles.em}>{t('home.hero.slides.three.accent')}</em>
      </p>
      <Link href="/collections/all/" className={home.button}>
        {t('home.hero.slides.three.action')} <Arrow className={home.arrow} />
      </Link>
      </div>
    </div>,
  ]

  return (
    <section className={styles.root} aria-roledescription={t('home.hero.kind')} aria-label={t('home.hero.label')} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className={shown === 0 ? styles.slideOn : styles.slide} aria-hidden={shown !== 0}>
        <ThemeImage src="hero-field.webp" alt={t('home.hero.slides.one.alt')} ratio={0.67} sizes="100vw" className={styles.image} />
      </div>
      <div className={shown === 1 ? styles.slideOn : styles.slide} aria-hidden={shown !== 1}>
        <ThemeImage src="hero-saree.webp" alt={t('home.hero.slides.two.alt')} ratio={0.67} sizes="100vw" className={styles.image} />
      </div>
      <div className={shown === 2 ? styles.slideOn : styles.slide} aria-hidden={shown !== 2}>
        <ThemeImage src="hero-denim.webp" alt={t('home.hero.slides.three.alt')} ratio={0.67} sizes="100vw" className={styles.image} />
      </div>
      {copy[shown]}
      <div className={styles.controls}>
        <div className={styles.dots}>
          <button type="button" className={shown === 0 ? styles.dotOn : styles.dot} aria-label={t('home.hero.showOne')} aria-current={shown === 0} onClick={() => show(0)} />
          <button type="button" className={shown === 1 ? styles.dotOn : styles.dot} aria-label={t('home.hero.showTwo')} aria-current={shown === 1} onClick={() => show(1)} />
          <button type="button" className={shown === 2 ? styles.dotOn : styles.dot} aria-label={t('home.hero.showThree')} aria-current={shown === 2} onClick={() => show(2)} />
        </div>
        <div className={styles.arrows}>
          {still ? null : (
            <button type="button" className={styles.previous} aria-label={stopped ? t('home.hero.play') : t('home.hero.pause')} onClick={() => setStopped((v) => !v)}>
              <svg className={styles.arrowIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d={stopped ? 'M8 5l11 7-11 7z' : 'M9 5v14 M15 5v14'} />
              </svg>
            </button>
          )}
          <button type="button" className={styles.previous} aria-label={t('home.hero.previous')} onClick={() => show((shown + count - 1) % count)}>
            <Arrow back className={styles.arrowIcon} />
          </button>
          <button type="button" className={styles.next} aria-label={t('home.hero.next')} onClick={() => show((shown + 1) % count)}>
            <Arrow className={styles.arrowIcon} />
          </button>
        </div>
      </div>
    </section>
  )
}
