import type { StaffSessionCopy } from './StaffSessionLayer'
import { firstName, type StaffSessionEndedBy } from './staffSession'

// The words each portal keeps in its own messages; the placeholders are filled here.
export interface StaffSessionWords {
  impersonating: string
  impersonatingDetail: string
  setup: string
  setupDetail: string
  endsIn: string
  end: string
  endFailed: string
  back: string
  action: string
  notice: string
  noticeSetup: string
  ended: string
  expired: string
  expiredSetup: string
  endedBody: Record<StaffSessionEndedBy, string>
}

export interface StaffSessionFormat {
  wait: (seconds: number) => string
  time: (iso: string) => string
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)

// An impersonation says Support and a setup session names DripFunnel (ACCESS.md §8.1, §8.2).
export const staffSessionCopy = (words: StaffSessionWords, format: StaffSessionFormat): StaffSessionCopy => ({
  bar: (session, seconds) => {
    const timeLeft = fill(words.endsIn, { time: format.wait(seconds) })
    const staff = session.staffName
    if (session.kind === 'impersonation' && session.actingAs) {
      const { name, role, where } = session.actingAs
      return { icon: 'user', lead: fill(words.impersonating, { user: name }), detail: fill(words.impersonatingDetail, { role, where, staff }), timeLeft }
    }
    return { icon: 'pen', lead: fill(words.setup, { partner: session.partnerName }), detail: fill(words.setupDetail, { staff }), timeLeft }
  },
  notice: (session, seconds) =>
    session.kind === 'impersonation' && session.actingAs
      ? fill(words.notice, { staff: firstName(session.staffName), user: firstName(session.actingAs.name), time: format.wait(seconds) })
      : fill(words.noticeSetup, { staff: firstName(session.staffName), time: format.time(session.expiresAt) }),
  over: (session) => {
    const title =
      session.state === 'expired'
        ? session.actingAs
          ? fill(words.expired, { user: firstName(session.actingAs.name) })
          : words.expiredSetup
        : words.ended
    return { title, body: words.endedBody[session.endedBy ?? 'expiry'] }
  },
  end: words.end,
  endFailed: words.endFailed,
  back: words.back,
  action: words.action,
})
