'use client'

import { useEffect, useRef, useState } from 'react'
import { Link, useReducedMotion } from '@dripfunnel/storefront-core/theme'
import { clsx } from 'clsx'

const autoplayMs = 4500
const swipePx = 40

export type HeroSlide = {
  key: string
  href: string
  /** What the artwork says, for screen readers: the banner's words are part of the picture. */
  label: string
  /** Which banner paints this slide, over a gradient while it loads. */
  art: 'first' | 'second' | 'third' | undefined
}

type HeroLabels = { region: string; role: string; previous: string; next: string; pause: string; play: string; goTo: (n: number) => string }

export const HeroCarousel = ({ slides, labels }: { slides: HeroSlide[]; labels: HeroLabels }) => {
  const [selected, setSelected] = useState(0)
  const [held, setHeld] = useState(false)
  const [stopped, setStopped] = useState(false)
  const reduced = useReducedMotion()
  const swipeFrom = useRef<number | null>(null)
  const count = slides.length
  // WCAG 2.2.2: no autoplay under reduced motion, and a pause button otherwise.
  const autoplay = count > 1 && !reduced && !stopped
  const go = (index: number) => setSelected((index + count) % count)
  // Slides before the current one wait off to the left, those after it off to the right.
  const place = (index: number) => (index === selected ? '[transform:translateX(0)]' : index < selected ? '[transform:translateX(-100%)]' : '[transform:translateX(100%)]')

  // One timer per slide: keying on `selected` gives every slide the full interval after any change.
  useEffect(() => {
    if (!autoplay || held) return
    const id = setTimeout(() => setSelected((i) => (i + 1) % count), autoplayMs)
    return () => clearTimeout(id)
  }, [autoplay, held, selected, count])

  return (
    <section
      className="relative overflow-hidden bg-deep [touch-action:pan-y]"
      aria-roledescription={labels.role}
      aria-label={labels.region}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHeld(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHeld(false)
      }}
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
      <div className="grid" aria-live={autoplay ? 'off' : 'polite'}>
        {slides.map((slide, index) => (
          <div key={slide.key} className={clsx('[grid-area:1_/_1] [@media(prefers-reduced-motion:reduce)]:[transition:none]', !(reduced) && '[transition:transform_0.6s_ease]', reduced && '[transition:none]', place(index))}>
            {/* Only the shown slide is a link, so off-screen ones are neither tabbed to nor read out. */}
            {index === selected ? (
              <Link href={slide.href} className={clsx('block w-full max-h-[calc(100svh_-_7.5rem)] aspect-[16/9] focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[-4px] bg-soft [background-position:center] [background-repeat:no-repeat]', !((slide.art === 'first') || (slide.art === 'second') || (slide.art === 'third')) && '[background-size:cover]', slide.art === 'first' && '[background-size:contain,cover] [background-image:radial-gradient(circle_at_70%_40%,#f7f5f2_0,#e6e1da_55%,#cfc7bc_100%)]', slide.art === 'second' && '[background-size:contain,cover] [background-image:radial-gradient(circle_at_70%_40%,#6b645d_0,#45403b_60%,#2f2b28_100%)]', slide.art === 'third' && '[background-size:contain,cover] [background-image:radial-gradient(circle_at_70%_40%,#f4f1ec_0,#e2dcd3_55%,#c9c0b3_100%)]')}>
                <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{slide.label}</span>
              </Link>
            ) : (
              <span className={clsx('block w-full max-h-[calc(100svh_-_7.5rem)] aspect-[16/9] focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[-4px] bg-soft [background-position:center] [background-repeat:no-repeat]', !((slide.art === 'first') || (slide.art === 'second') || (slide.art === 'third')) && '[background-size:cover]', slide.art === 'first' && '[background-size:contain,cover] [background-image:radial-gradient(circle_at_70%_40%,#f7f5f2_0,#e6e1da_55%,#cfc7bc_100%)]', slide.art === 'second' && '[background-size:contain,cover] [background-image:radial-gradient(circle_at_70%_40%,#6b645d_0,#45403b_60%,#2f2b28_100%)]', slide.art === 'third' && '[background-size:contain,cover] [background-image:radial-gradient(circle_at_70%_40%,#f4f1ec_0,#e2dcd3_55%,#c9c0b3_100%)]')} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      {count > 1 ? (
        <>
          <button type="button" className={clsx('p-0 border border-[rgb(179_165_147_/_60%)] absolute top-[50%] hidden w-11 h-11 items-center justify-center rounded-full bg-[rgb(0_0_0_/_25%)] text-[#fff] cursor-pointer [transform:translateY(-50%)] [backdrop-filter:blur(4px)] hover:bg-[rgb(0_0_0_/_45%)] [&_svg]:w-5 [&_svg]:h-5 [&_svg]:[fill:none] [&_svg]:[stroke:currentcolor] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:2] focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px] min-[640px]:flex', 'left-3 min-[768px]:left-6')} aria-label={labels.previous} onClick={() => go(selected - 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button type="button" className={clsx('p-0 border border-[rgb(179_165_147_/_60%)] absolute top-[50%] hidden w-11 h-11 items-center justify-center rounded-full bg-[rgb(0_0_0_/_25%)] text-[#fff] cursor-pointer [transform:translateY(-50%)] [backdrop-filter:blur(4px)] hover:bg-[rgb(0_0_0_/_45%)] [&_svg]:w-5 [&_svg]:h-5 [&_svg]:[fill:none] [&_svg]:[stroke:currentcolor] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:2] focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px] min-[640px]:flex', 'right-3 min-[768px]:right-6')} aria-label={labels.next} onClick={() => go(selected + 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          {reduced ? null : (
            <button type="button" className="p-0 border border-[rgb(179_165_147_/_60%)] absolute bottom-1 left-3 flex w-8 h-8 items-center justify-center rounded-full bg-[rgb(0_0_0_/_25%)] text-[#fff] cursor-pointer hover:bg-[rgb(0_0_0_/_45%)] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:[fill:currentcolor] [&_svg]:[stroke:currentcolor] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:2] focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px] min-[768px]:bottom-3 min-[768px]:left-6" aria-label={stopped ? labels.play : labels.pause} onClick={() => setStopped(!stopped)}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d={stopped ? 'M8 5l11 7-11 7z' : 'M8 5v14M16 5v14'} />
              </svg>
            </button>
          )}
          <div className="absolute bottom-1 left-[50%] flex [transform:translateX(-50%)] min-[768px]:bottom-3">
            {slides.map((slide, index) => (
              <button key={slide.key} type="button" className={clsx("py-0 px-0.5 border-0 border-current flex min-w-6 h-6 items-center justify-center bg-transparent cursor-pointer [&::before]:h-1.5 [&::before]:rounded-full [&::before]:[content:''] [&:hover::before]:bg-[#fff] focus-visible:[outline:2px_solid_var(--color-taupe)] focus-visible:outline-offset-[2px]", !(index === selected) && '[&::before]:w-3 [&::before]:bg-[rgb(255_255_255_/_60%)]', index === selected && '[&::before]:w-8 [&::before]:bg-taupe')} aria-label={labels.goTo(index + 1)} aria-current={index === selected} onClick={() => go(index)} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
