import { loadMe } from '../../api/me'
import { loadNavBadges } from '../../api/navBadges'

export const loadShell = async () => {
  const [me, badges] = await Promise.all([loadMe(), loadNavBadges()])
  return { me, badges }
}
