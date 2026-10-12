'use client'

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'

// The browser behaviour a theme's interactive islands get instead of window and document (ARCHITECTURE §2.1
// `platform/browser`, §3.4). Each answers its resting value where there is no browser, so a static page renders the same.

/** Whether a media query such as "(min-width: 760px)" matches; false in a static build. */
export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (changed) => {
      const list = matchMedia(query)
      list.addEventListener('change', changed)
      return () => list.removeEventListener('change', changed)
    },
    () => matchMedia(query).matches,
    () => false,
  )

/** Whether the shopper asked for less motion; core's <Video> and a theme's animations both follow it. */
export const useReducedMotion = (): boolean => useMediaQuery('(prefers-reduced-motion: reduce)')

/** Whether the element is on screen; with `once`, it stays true after it first shows. */
export const useInView = (ref: RefObject<Element | null>, { once = false }: { once?: boolean } = {}): boolean => {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry?.isIntersecting ?? false
      setSeen(visible)
      if (visible && once) observer.disconnect()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, once])
  return seen
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** How far the element has passed through the screen, 0 as it enters at the bottom and 1 as it leaves at the top; the page's own progress without a ref. */
export const useScrollProgress = (ref?: RefObject<Element | null>): number => {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const element = ref?.current
      if (element) {
        const box = element.getBoundingClientRect()
        setProgress(clamp((innerHeight - box.top) / (innerHeight + box.height)))
      } else {
        const room = document.documentElement.scrollHeight - innerHeight
        setProgress(room > 0 ? clamp(scrollY / room) : 0)
      }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    addEventListener('scroll', onScroll, { passive: true })
    addEventListener('resize', onScroll)
    return () => {
      removeEventListener('scroll', onScroll)
      removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref])
  return progress
}

/** Where the pointer is over the element, each axis from 0 to 1, or null while it's elsewhere. */
export const usePointer = (ref: RefObject<Element | null>): { x: number; y: number } | null => {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const move = (event: Event) => {
      if (!(event instanceof PointerEvent)) return
      const box = element.getBoundingClientRect()
      setAt(box.width && box.height ? { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) } : null)
    }
    const leave = () => setAt(null)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
    }
  }, [ref])
  return at
}
