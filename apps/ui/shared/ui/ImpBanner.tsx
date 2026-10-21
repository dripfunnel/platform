import { useEffect, useId, useRef } from 'react'
import './session.css'

const icons = {
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
}

export interface ImpBannerProps {
  icon: 'user' | 'pen'
  lead: string
  detail: string
  host: string
  timeLeft: string
  endLabel: string
  onEnd: () => void
  // Back to the console that started it; the session keeps running.
  back: { label: string; href: string }
  // Why the last End didn't go through, or null.
  error?: string | null
}

// The staff member's bar in the portal (designs/ImpBanner.dc.html): sticky, so it can't be
// scrolled away, and nothing closes it but ending the session.
export const ImpBanner = ({ icon, lead, detail, host, timeLeft, endLabel, onEnd, back, error = null }: ImpBannerProps) => (
  <div className="df-session-bar" role="status" aria-live="polite">
    <svg className="df-session-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d={icons[icon]} />
    </svg>
    <span className="df-session-text">
      <strong>{lead}</strong> {detail} · <span className="df-session-host">{host}</span> · <strong className="df-session-time">{timeLeft}</strong>
    </span>
    <span className="df-session-actions">
      <a className="df-session-back" href={back.href}>
        {back.label}
      </a>
      <button type="button" className="df-session-end" onClick={onEnd}>
        {endLabel}
      </button>
    </span>
    {error && (
      <span className="df-session-error" role="alert">
        {error}
      </span>
    )}
  </div>
)

// What everyone else signed in sees while a staff session is open (ACCESS.md §8.1, §8.2).
export const SessionNotice = ({ text }: { text: string }) => (
  <div className="df-session-bar df-session-bar--notice" role="status" aria-live="polite">
    <svg className="df-session-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d={icons.user} />
    </svg>
    <span className="df-session-text">{text}</span>
  </div>
)

// Makes every element beside the card's branch inert, so Tab and clicks can't reach the page
// behind it; returns the undo.
const inertAround = (element: HTMLElement): (() => void) => {
  const made: HTMLElement[] = []
  for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) {
        sibling.inert = true
        made.push(sibling)
      }
    }
  }
  return () => {
    for (const sibling of made) sibling.inert = false
  }
}

export interface SessionEndCardProps {
  title: string
  body: string
  action: { label: string; href: string }
}

// The full-screen card once a session is over or its link is spent: nothing behind it is usable.
export const SessionEndCard = ({ title, body, action }: SessionEndCardProps) => {
  const titleId = useId()
  const overRef = useRef<HTMLDivElement>(null)
  const actionRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    actionRef.current?.focus()
    const over = overRef.current
    return over ? inertAround(over) : undefined
  }, [])
  return (
    <div ref={overRef} className="df-session-over" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="df-session-card">
        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
          <path d={icons.clock} />
        </svg>
        <h1 id={titleId}>{title}</h1>
        <p>{body}</p>
        <a ref={actionRef} className="df-session-card-action" href={action.href}>
          {action.label}
        </a>
      </div>
    </div>
  )
}
