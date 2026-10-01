import { loadMe, partnerStateFor, type Me } from '../../api/me'
import { loadNavBadges } from '../../api/navBadges'

export const loadShell = async ({ searchStr }: { searchStr: string }): Promise<{ me: Me; badges: Awaited<ReturnType<typeof loadNavBadges>> }> => {
  const loaded = await loadMe()
  const me = { ...loaded, partner: { ...loaded.partner, state: partnerStateFor(loaded.partner.state, searchStr) } }
  return { me, badges: await loadNavBadges(me.partner.state) }
}
