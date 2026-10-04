import type { ImpersonationTarget, Reauth, Ref, StaffSession, StartResult } from '../../api/impersonation'

export type StartSubject =
  | { kind: 'impersonation'; target: ImpersonationTarget; membershipId: string | null }
  | { kind: 'setup'; partner: Ref }

export type StartStep = 'blocked' | 'busy' | 'return' | 'where' | 'why' | 'confirm' | 'reauth' | 'msg'

export type CountedStep = 'where' | 'why' | 'confirm'

const chosenMembership = (subject: Extract<StartSubject, { kind: 'impersonation' }>) =>
  subject.membershipId ?? (subject.target.memberships.length === 1 ? (subject.target.memberships[0]?.id ?? null) : null)

export const membershipOf = (subject: StartSubject): string | null => (subject.kind === 'impersonation' ? chosenMembership(subject) : null)

// The steps that count towards "Step 1 of 3": where only when there is a choice to make.
export const countedSteps = (subject: StartSubject, membershipGiven: boolean): readonly CountedStep[] =>
  subject.kind === 'impersonation' && subject.target.memberships.length > 1 && !membershipGiven ? ['where', 'why', 'confirm'] : ['why', 'confirm']

export const openOfKind = (mine: readonly StaffSession[], kind: StaffSession['kind']) => mine.find((session) => session.kind === kind && session.outcome === 'open')

// Where the flow opens, in the prototype's order: refused, already in it, busy elsewhere, then the questions.
export const firstStep = (subject: StartSubject, mine: readonly StaffSession[]): StartStep => {
  if (subject.kind === 'setup') {
    const open = openOfKind(mine, 'setup')
    if (open) return open.partner.id === subject.partner.id ? 'return' : 'busy'
    return 'why'
  }
  if (!subject.target.impersonate.allowed) return 'blocked'
  if (subject.target.openSession) return 'return'
  if (openOfKind(mine, 'impersonation')) return 'busy'
  return afterBusy(subject)
}

export const afterBusy = (subject: StartSubject): StartStep => (membershipOf(subject) === null ? 'where' : 'why')

export type StartOutcome = { kind: 'done'; result: StartResult } | { kind: 'signIn'; outcome: 'failed' | 'cancelled' | 'blocked' }

// ACCESS.md §8.1: ask to start; only on REAUTH_REQUIRED sign in again (in the reserved tab) and
// ask once more. A second REAUTH_REQUIRED means the sign-in didn't take, whatever page it ended on.
export const startWithReauth = async (start: () => Promise<StartResult>, signIn: () => Promise<Reauth>, tabBlocked: boolean): Promise<StartOutcome> => {
  const first = await start()
  if (first.ok || first.reason !== 'REAUTH_REQUIRED') return { kind: 'done', result: first }
  if (tabBlocked) return { kind: 'signIn', outcome: 'blocked' }
  const fresh = await signIn()
  if (!fresh.ok) return { kind: 'signIn', outcome: fresh.outcome }
  const again = await start()
  return !again.ok && again.reason === 'REAUTH_REQUIRED' ? { kind: 'signIn', outcome: 'failed' } : { kind: 'done', result: again }
}
