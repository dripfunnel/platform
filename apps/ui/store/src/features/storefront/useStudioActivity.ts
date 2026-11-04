import { useCallback, useEffect } from 'react'
import { activityEveryMs } from './studioRules'
import type { StorefrontApi } from './storefrontApi'

const lastSent = new WeakMap<StorefrontApi, number>()

/**
 * `studioActivity` (storefront AI-STUDIO §7 "Stopping"): at most every 30 s for the whole portal, never from a hidden
 * tab, so the container wakes before Send and stops 5 minutes after the merchant last did anything.
 */
export const wakeStudio = (api: StorefrontApi): void => {
  if (document.visibilityState !== 'visible') return
  const now = Date.now()
  if (now - (lastSent.get(api) ?? Number.NEGATIVE_INFINITY) < activityEveryMs) return
  lastSent.set(api, now)
  // A lost one costs only a cold start at Send.
  api.studioActivity().catch(() => lastSent.delete(api))
}

/** `wakeStudio` on focus or typing in the studio, and on a click into its frame. */
export const useStudioActivity = (api: StorefrontApi, open: boolean): (() => void) => {
  const poke = useCallback(() => void (open && wakeStudio(api)), [api, open])
  // A click in the frame moves focus out of this window into the frame's.
  useEffect(() => {
    const onBlur = () => setTimeout(() => document.activeElement instanceof HTMLIFrameElement && poke(), 0)
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [poke])
  return poke
}
