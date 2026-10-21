import { redirect } from '@tanstack/react-router'
import { callerFor, loadMe, meForPartnerState, type Me } from '../../api/me'
import { loadNavBadges } from '../../api/navBadges'
import { loadPartnerFacts, type PartnerFacts } from '../../api/partnerState'

export interface ShellSearch {
  partner?: string | undefined
  state?: string | undefined
}

// The signed-in user for the shell and every child route's loader (route context). Nobody signed
// in means sign-in, coming back here after (ACCESS §4). `?state=` and `?partner=` are the harness's.
export const requireMe = async ({ partner, state }: ShellSearch, here: string): Promise<Me> => {
  const loaded = await loadMe()
  if (!loaded) throw redirect({ to: '/sign-in', search: { next: here } })
  return meForPartnerState({ ...loaded, role: callerFor(loaded.role, state) }, partner)
}

// The facts follow a harness partner state, so ?partner= shows that state's banners too.
export const loadShell = async (me: Me): Promise<{ me: Me; facts: PartnerFacts; badges: Awaited<ReturnType<typeof loadNavBadges>> }> => {
  const [facts, badges] = await Promise.all([loadPartnerFacts(), loadNavBadges()])
  return { me, facts: { ...facts, state: me.partner.state }, badges }
}
