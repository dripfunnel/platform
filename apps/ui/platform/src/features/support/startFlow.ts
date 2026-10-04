import type { SupportSession, SupportTarget } from '../../api/support'

export type StartStep = 'blocked' | 'busy' | 'return' | 'why' | 'confirm' | 'starting' | 'msg'

// Where the dialog opens, in the prototype's order: already in it, refused, busy elsewhere, then the questions.
export const firstStep = (target: SupportTarget, mine: SupportSession | null): StartStep => {
  if (target.mySessionId) return 'return'
  if (!target.start.allowed) return 'blocked'
  if (mine) return 'busy'
  return 'why'
}

export const codeComplete = (code: string): boolean => /^\d{6}$/.test(code)
