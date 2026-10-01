import { callerFor, loadMe, partnerStateFor, type Me } from '../../api/me'
import { loadNavBadges, type NavBadges } from '../../api/navBadges'

export interface ShellSearch {
  partner?: string | undefined
  state?: string | undefined
}

// `?state=` and `?partner=` are the harness's (api/me.ts); nothing else in the search re-runs this.
export const loadShell = async ({ partner, state }: ShellSearch): Promise<{ me: Me; badges: NavBadges }> => {
  const loaded = await loadMe()
  const me = { ...loaded, role: callerFor(loaded.role, state), partner: { ...loaded.partner, state: partnerStateFor(loaded.partner.state, partner) } }
  return { me, badges: await loadNavBadges(me.partner.state) }
}
