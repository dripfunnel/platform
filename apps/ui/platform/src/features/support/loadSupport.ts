import { loadSupportSessions, loadSupportTargets, type Page, type SupportSession, type SupportTarget } from '../../api/support'
import type { PartnerRole } from '../shell/partnerRoles'
import type { SupportTab } from './supportHarness'
import { supportAllowed } from './supportText'

export type SupportData =
  | { refused: true }
  | { refused: false; open: Page<SupportSession>; users: Page<SupportTarget> | null; history: Page<SupportSession> | null }

// The open sessions on both tabs: Users needs the caller's own for "one at a time" (§12.2).
export const loadSupport = async (role: PartnerRole, tab: SupportTab): Promise<SupportData> => {
  if (!supportAllowed(role)) return { refused: true }
  const [open, users, history] = await Promise.all([
    loadSupportSessions(true, {}),
    tab === 'users' ? loadSupportTargets(undefined, {}) : Promise.resolve(null),
    tab === 'sessions' ? loadSupportSessions(false, {}) : Promise.resolve(null),
  ])
  return { refused: false, open, users, history }
}
