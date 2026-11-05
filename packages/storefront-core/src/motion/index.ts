'use client'

import { useInsertionEffect, useMemo } from 'react'
import { attachSpring, isMotionValue, motionValue, MotionGlobalConfig, useMotionValue, useScroll as useLiveScroll, type MotionValue, type SpringOptions, type UseScrollOptions } from 'motion/react'
import { useReducedMotion } from '../platform/browser/hooks'

// The motion a theme's interactive islands import (storefront ARCHITECTURE §3.4; #1245): motion itself, with the
// shopper's reduced motion kept by core, so no theme can leave it out.
export * from 'motion/react'

const reduce = '(prefers-reduced-motion: reduce)'

/** Every motion animation (variants, layout, presence, animate()) ends at once while the shopper asks for less motion. */
export const followReducedMotion = (list: Pick<MediaQueryList, 'matches'>): void => {
  MotionGlobalConfig.skipAnimations = list.matches
}

if (typeof matchMedia === 'function') {
  const list = matchMedia(reduce)
  followReducedMotion(list)
  list.addEventListener('change', () => followReducedMotion(list))
}

/** motion's useScroll; under reduced motion its values hold still, with progress at its end, where a reveal shows. */
export const useScroll = (options?: UseScrollOptions): ReturnType<typeof useLiveScroll> => {
  const live = useLiveScroll(options)
  const still = useMemo(() => ({ scrollX: motionValue(0), scrollY: motionValue(0), scrollXProgress: motionValue(1), scrollYProgress: motionValue(1) }), [])
  return useReducedMotion() ? still : live
}

/** motion's useSpring (as motion's own useFollow builds it); under reduced motion it follows its source at once. */
export function useSpring(source: MotionValue<string> | string, options?: SpringOptions): MotionValue<string>
export function useSpring(source: MotionValue<number> | number, options?: SpringOptions): MotionValue<number>
export function useSpring<T extends string | number>(source: MotionValue<T> | T, options: SpringOptions = {}): MotionValue<T> {
  const still = useReducedMotion()
  const value = useMotionValue<T>(isMotionValue(source) ? source.get() : source)
  const settings = JSON.stringify(options)
  useInsertionEffect(() => {
    if (!still) return attachSpring(value, source, options)
    value.set(isMotionValue(source) ? source.get() : source)
    return isMotionValue(source) ? source.on('change', (v) => value.set(v)) : undefined
    // The options are compared by their JSON, as motion's own useSpring does.
  }, [value, source, still, settings])
  return value
}
