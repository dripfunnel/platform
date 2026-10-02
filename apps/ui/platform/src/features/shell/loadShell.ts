import { callerFor, loadMe, meForPartnerState, type Me } from '../../api/me'

export interface ShellSearch {
  partner?: string | undefined
  state?: string | undefined
}

// The signed-in user for the shell and every child route's loader (route context). `?state=` and
// `?partner=` are the harness's (api/me.ts).
export const loadShellMe = async ({ partner, state }: ShellSearch): Promise<Me> => {
  const loaded = await loadMe()
  return meForPartnerState({ ...loaded, role: callerFor(loaded.role, state) }, partner)
}
