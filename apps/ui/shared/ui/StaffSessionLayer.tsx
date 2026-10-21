import { useState } from 'react'
import { ImpBanner, SessionEndCard, SessionNotice, type ImpBannerProps } from './ImpBanner'
import { secondsLeft, sessionStateAt, type PortalStaffSession } from './staffSession'
import { useNow, usePolling } from './usePolling'

export interface StaffSessionCopy {
  bar: (session: PortalStaffSession, secondsLeft: number) => Pick<ImpBannerProps, 'icon' | 'lead' | 'detail' | 'timeLeft'>
  notice: (session: PortalStaffSession, secondsLeft: number) => string
  over: (session: PortalStaffSession) => { title: string; body: string }
  end: string
  endFailed: string
  back: string
  action: string
}

export interface StaffSessionLayerProps {
  loadCurrent: () => Promise<PortalStaffSession | null>
  loadNotice: () => Promise<PortalStaffSession | null>
  end: (id: string) => Promise<void>
  adminUrl: string
  copy: StaffSessionCopy
}

// The portal's view of a staff session, from the server's state rather than browser storage
// (decided on #46): the staff member's bar, everyone else's notice, or the card once it is over.
export const StaffSessionLayer = ({ loadCurrent, loadNotice, end, adminUrl, copy }: StaffSessionLayerProps) => {
  const now = useNow()
  const mine = usePolling(loadCurrent)
  const others = usePolling(loadNotice)
  const [endFailed, setEndFailed] = useState(false)
  const session = mine.value
  if (session) {
    const state = sessionStateAt(session, now)
    if (state !== 'open') {
      const over = copy.over({ ...session, state, endedBy: session.endedBy ?? 'expiry' })
      return <SessionEndCard title={over.title} body={over.body} action={{ label: copy.action, href: adminUrl }} />
    }
    return (
      <ImpBanner
        {...copy.bar(session, secondsLeft(session.expiresAt, now))}
        host={session.host}
        endLabel={copy.end}
        error={endFailed ? copy.endFailed : null}
        onEnd={() => {
          setEndFailed(false)
          end(session.id).then(mine.refresh, () => setEndFailed(true))
        }}
        back={{ label: copy.back, href: adminUrl }}
      />
    )
  }
  const notice = others.value
  if (notice && sessionStateAt(notice, now) === 'open') return <SessionNotice text={copy.notice(notice, secondsLeft(notice.expiresAt, now))} />
  return null
}
