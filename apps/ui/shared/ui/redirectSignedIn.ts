import { redirect } from '@tanstack/react-router'
import { safeNext } from './safeNext'

/**
 * Sends a signed-in person on from sign-in, Forgot password or sign-up to `next` (same-app only) or
 * home (#1122). Nobody signed in, or a read that fails, leaves the page to show as before.
 */
export const redirectSignedIn = async ({ loadMe, next, home, skip = false, origin = window.location.origin }: { loadMe: () => Promise<unknown>; next: unknown; home: string; skip?: boolean; origin?: string }): Promise<void> => {
  if (skip) return
  let me: unknown
  try {
    me = await loadMe()
  } catch {
    return
  }
  if (me) throw redirect({ href: safeNext(next, origin, home) })
}

/** The design-preview harness's `?state=` (ui/README.md §6), which shows the page's sample states instead. */
export const previewsState = (harness: boolean, searchStr: string): boolean => harness && new URLSearchParams(searchStr).has('state')
