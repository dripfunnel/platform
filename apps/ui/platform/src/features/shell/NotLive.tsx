import { Icon } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { Me } from '../../api/me'
import { fill, messages } from '../../messages'
import './notLive.css'

const words = messages.shell.notLive

// A screen that needs merchants, before the partner is Live (FIRST-RELEASE.md §1): what it will hold,
// why it is empty, and the way to the checklist.
export const NotLive = ({ what, me }: { what: string; me: Me }) => (
  <div className="df-page">
    <section className="df-not-live">
      <Icon name="clock" size={28} />
      <h1 className="df-page-title">{fill(words.title, { what, product: me.partner.product })}</h1>
      <p>{me.partner.state === 'awaiting' ? words.awaiting : words.draft}</p>
      <Link to="/dashboard">{words.link}</Link>
    </section>
  </div>
)
