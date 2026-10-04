import { loadMySupportSession, loadSupportSessions, loadSupportTargets, type Page, type SupportSession, type SupportTarget } from '../../api/support'
import type { PartnerRole } from '../shell/partnerRoles'
import type { SupportTab } from './supportHarness'
import { supportAllowed } from './supportText'

export type SupportData =
  | { refused: true }
  | { refused: false; open: Page<SupportSession>; mine: SupportSession | null; users: Page<SupportTarget> | null; history: Page<SupportSession> | null }

// The open sessions and the caller's own on both tabs: Users needs it for "one at a time" (§12.2).
export const loadSupport = async (role: PartnerRole, tab: SupportTab): Promise<SupportData> => {
  if (!supportAllowed(role)) return { refused: true }
  const [open, mine, users, history] = await Promise.all([
    loadSupportSessions(true, {}),
    loadMySupportSession(),
    tab === 'users' ? loadSupportTargets(undefined, {}) : Promise.resolve(null),
    tab === 'sessions' ? loadSupportSessions(false, {}) : Promise.resolve(null),
  ])
  return { refused: false, open, mine, users, history }
}
