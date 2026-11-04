import { useCallback, useEffect, useRef } from 'react'
import { activityEveryMs } from './studioRules'
import type { StorefrontApi } from './storefrontApi'

/**
 * `studioActivity` on focus or typing (storefront AI-STUDIO §7 "Stopping"): at most every 30 s, never from a hidden tab,
 * so the container wakes before Send and stops 5 minutes after the merchant last did anything.
 */
export const useStudioActivity = (api: StorefrontApi, open: boolean): (() => void) => {
  const last = useRef(Number.NEGATIVE_INFINITY)
  const poke = useCallback(() => {
    if (!open || document.visibilityState !== 'visible') return
    const now = Date.now()
    if (now - last.current < activityEveryMs) return
    last.current = now
    api.studioActivity().catch(() => {
      // A lost one costs only a cold start at Send.
      last.current = Number.NEGATIVE_INFINITY
    })
  }, [api, open])
  // A click in the frame moves focus out of this window into the frame's.
  useEffect(() => {
    const onBlur = () => setTimeout(() => document.activeElement instanceof HTMLIFrameElement && poke(), 0)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [poke])
  return poke
}
