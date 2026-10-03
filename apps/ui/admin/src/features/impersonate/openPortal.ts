// The portal opens in a new tab (FIRST-RELEASE.md §8). The tab is opened on the click itself,
// before the sign-in and the API answer, because a browser blocks a tab opened later.
import type { Reauth } from '../../api/impersonation'

export interface PortalTab {
  go: (url: string) => void
  close: () => void
  blocked: boolean
  // The fresh SSO sign-in a session start asks for, run in this same tab.
  reauthenticate: () => Promise<Reauth>
}

export const reservePortalTab = (): PortalTab => {
  const tab = window.open('about:blank', '_blank')
  if (tab) tab.opener = null
  return {
    go: (url) => {
      if (tab) tab.location.replace(url)
    },
    close: () => tab?.close(),
    blocked: tab === null,
    reauthenticate: () => (tab ? reauthenticateIn(tab) : Promise.resolve({ ok: false, outcome: 'failed' })),
  }
}

const reauthPath = '/api/auth/reauth'
const pollMs = 500
const giveUpMs = 10 * 60_000

// The company SSO's fresh sign-in runs in the tab the portal will open in (ACCESS.md §8.1): the
// API stamps this session and sends the tab back to `/`, which is when the dialog carries on. A
// tab at Microsoft can't be read; back on this host it can, and sign-in means it was refused.
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
      done(path.startsWith('/sign-in') ? { ok: false, outcome: 'failed' } : { ok: true })
    }, pollMs)
    const done = (result: Reauth) => {
      clearInterval(timer)
      resolve(result)
    }
  })
