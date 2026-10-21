import { redirect } from '@tanstack/react-router'
import { loadMe, type Me } from '../../api/me'
import { loadNavBadges } from '../../api/navBadges'

// Nobody signed in means the sign-in screen, from any route (ui/README.md §3: the session is
// the API's cookie, which only `me` can report on).
export const requireMe = async (): Promise<Me> => {
  const me = await loadMe()
  if (!me) throw redirect({ to: '/sign-in' })
  return me
}

export const loadShell = async (me: Me) => ({ me, badges: await loadNavBadges() })
