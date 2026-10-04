import type { Opened, Reauth, SupportRefusal, SupportSession, SupportTarget } from '../../api/support'
import { reauthText, refusalText } from './supportText'

export type StartStep = 'blocked' | 'busy' | 'return' | 'why' | 'confirm' | 'starting' | 'msg'

// Where the dialog opens, in the prototype's order: already in it, refused, busy elsewhere, then the questions.
export const firstStep = (target: SupportTarget, mine: SupportSession | null): StartStep => {
  if (target.mySessionId) return 'return'
  if (!target.start.allowed) return 'blocked'
  if (mine) return 'busy'
  return 'why'
}

export const codeComplete = (code: string): boolean => /^\d{6}$/.test(code)

// The open session in the way: the one the API names, with the page's copy only when it is that one.
export const blockingSession = (sessionId: string | null, mine: SupportSession | null): { id: string; session: SupportSession | null } | null => {
  const id = sessionId ?? mine?.id ?? null
  return id ? { id, session: mine?.id === id ? mine : null } : null
}

export interface OpeningTab {
  go: (url: string) => void
  close: () => void
}

export type Outcome =
  | { kind: 'opened' }
  | { kind: 'badCode'; refusal: Extract<Reauth, { ok: false }> }
  | { kind: 'busy'; sessionId: string | null }
  | { kind: 'refused'; reason: SupportRefusal }

// The tab reserved on the click goes to the link, or is closed: on every refusal and every failure.
export const openIn = async (tab: OpeningTab, ask: () => Promise<Outcome | Opened>): Promise<Outcome> => {
  let answer: Outcome | Opened
  try {
    answer = await ask()
  } catch (error) {
    tab.close()
    throw error
  }
  if ('ok' in answer) {
    if (answer.ok) {
      tab.go(answer.link)
      return { kind: 'opened' }
    }
    tab.close()
    return answer.reason === 'SUPPORT_SESSION_ALREADY_OPEN' ? { kind: 'busy', sessionId: answer.sessionId } : { kind: 'refused', reason: answer.reason }
  }
  tab.close()
  return answer
}

// ACCESS.md §8: the code buys a single-use proof; only a proof ever reaches the start.
export const startWith = (tab: OpeningTab, code: string, api: { reauthenticate: (code: string) => Promise<Reauth>; start: (proof: string) => Promise<Opened> }): Promise<Outcome> =>
  openIn(tab, async () => {
    const proof = await api.reauthenticate(code)
    return proof.ok ? api.start(proof.proof) : { kind: 'badCode', refusal: proof }
  })

export type After =
  | { to: 'done' }
  | { to: 'confirm'; error: string }
  | { to: 'busy'; other: ReturnType<typeof blockingSession> }
  | { to: 'msg'; text: string }

// Where the dialog goes next. Only a start goes back to its code; a refused Return has no form
// to go back to, so it says why and stops.
export const afterOutcome = (outcome: Outcome, from: 'start' | 'return', target: SupportTarget, mine: SupportSession | null): After => {
  switch (outcome.kind) {
    case 'opened':
      return { to: 'done' }
    case 'badCode':
      return { to: 'confirm', error: reauthText(outcome.refusal) }
    case 'busy':
      return from === 'start' ? { to: 'busy', other: blockingSession(outcome.sessionId, mine) } : { to: 'msg', text: refusalText('SUPPORT_SESSION_ALREADY_OPEN') }
    case 'refused':
      return from === 'start' && outcome.reason === 'REAUTH_REQUIRED' ? { to: 'confirm', error: refusalText(outcome.reason) } : { to: 'msg', text: refusalText(outcome.reason, target) }
  }
}
