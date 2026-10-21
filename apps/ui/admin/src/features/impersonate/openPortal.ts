// The portal opens in a new tab (FIRST-RELEASE.md §8), reserved on the click (shared reserveTab).
import { reserveTab, type ReservedTab } from '@dripfunnel/shared/ui'
import type { Reauth } from '../../api/impersonation'

export interface PortalTab extends Omit<ReservedTab, 'tab'> {
  // The fresh SSO sign-in a session start asks for, run in this same tab.
  reauthenticate: () => Promise<Reauth>
}

export const reservePortalTab = (): PortalTab => {
  const { tab, ...reserved } = reserveTab()
  return { ...reserved, reauthenticate: () => (tab ? reauthenticateIn(tab) : Promise.resolve({ ok: false, outcome: 'failed' })) }
}

const reauthPath = '/api/auth/reauth'
const pollMs = 500
const giveUpMs = 10 * 60_000

// The company SSO's fresh sign-in runs in the tab the portal will open in (ACCESS.md §8.1): the
// API stamps this session and sends the tab back to `/`, which is when the dialog asks again. A
// tab at Microsoft can't be read; back on this host it can. The API's answer is the real proof.
const reauthenticateIn = (tab: Window): Promise<Reauth> =>
  new Promise((resolve) => {
    const startedAt = Date.now()
    tab.location.replace(reauthPath)
    const timer = setInterval(() => {
      if (tab.closed) return done({ ok: false, outcome: 'cancelled' })
      if (Date.now() - startedAt > giveUpMs) return done({ ok: false, outcome: 'failed' })
      let path: string
      try {
        if (tab.location.origin !== window.location.origin) return
        path = tab.location.pathname
      } catch {
        return
      }
      if (path === 'blank' || path.startsWith('/api/auth/')) return
      // Success lands on `/`; a refusal on /sign-in?outcome=…, and anything else is no proof either.
      done(path === '/' ? { ok: true } : { ok: false, outcome: 'failed' })
    }, pollMs)
    const done = (result: Reauth) => {
      clearInterval(timer)
      resolve(result)
    }
  })
