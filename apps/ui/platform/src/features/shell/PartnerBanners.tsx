import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { Me } from '../../api/me'
import type { PartnerFacts } from '../../api/partnerState'
import { fill, formatList, formatTime, messages, plural } from '../../messages'
import './partner.css'

const words = messages.shell.banners

type Tone = 'info' | 'warning' | 'danger'

const Strip = ({ tone, children, link }: { tone: Tone; children: ReactNode; link: ReactNode }) => (
  <div role="status" className={`df-partner-strip df-partner-strip--${tone}`}>
    <p>{children}</p>
    {link}
  </div>
)

const external = (href: string, label: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {label}
    <span className="df-visually-hidden"> {messages.shell.opensInNewTab}</span>
  </a>
)

const preLiveTone = { draft: 'info', awaiting: 'warning', sentback: 'danger' } as const

// The shell's strips from the partner's facts (FIRST-RELEASE.md §2.3), each worded here. The
// contract, store-limit, payout and card banners wait for facts the API doesn't send yet.
export const PartnerBanners = ({ me, facts }: { me: Me; facts: PartnerFacts }) => {
  const { state } = facts
  const stores = plural({ one: words.storesOne, other: words.storesMany }, facts.storeCount)
  return (
    <>
      {(state === 'draft' || state === 'awaiting' || state === 'sentback') && (
        <Strip tone={preLiveTone[state]} link={<Link to="/dashboard">{messages.shell.partnerState[state].link}</Link>}>
          {messages.shell.partnerState[state].text}
        </Strip>
      )}
      {state === 'paused' && (
        <Strip tone="warning" link={<a href={words.partnerManagerHref}>{words.partnerManager}</a>}>
          <strong>{fill(words.paused.title, { product: me.partner.product })}</strong>{' '}
          {fill(me.partner.host ? words.paused.body : words.paused.bodyNoHost, { host: me.partner.host ?? '', stores: fill(stores, { count: String(facts.storeCount) }) })}
          {facts.pauseReason && ` ${fill(words.paused.reason, { reason: facts.pauseReason })}`}
        </Strip>
      )}
      {state === 'offboarding' && (
        <Strip tone="warning" link={external(words.offboarding.href, words.offboarding.link)}>
          <strong>{fill(words.offboarding.title, { partner: me.partner.name })}</strong> {words.offboarding.body}
        </Strip>
      )}
      {facts.brokenHosts.length > 0 && (
        <Strip tone="danger" link={<Link to="/domains">{words.domains.link}</Link>}>
          <strong>{fill(words.domains.title, { hosts: formatList(facts.brokenHosts) })}</strong> {words.domains.body}
        </Strip>
      )}
      {facts.setupSession && (
        <Strip tone="info" link={<Link to="/activity">{words.setup.link}</Link>}>
          {fill(messages.staffSession.noticeSetup, { staff: facts.setupSession.staffName, time: formatTime(facts.setupSession.endsAt) })}
        </Strip>
      )}
    </>
  )
}
