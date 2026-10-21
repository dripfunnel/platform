import { Link } from '@tanstack/react-router'
import type { ActivityFilter, ActivityPerson } from '../../api/activity'
import { fill, formatCount, messages, plural } from '../../messages'
import { Tile } from '@dripfunnel/shared/ui'
import './activityLog.css'

const words = messages.activity.person

export interface PersonCardProps {
  person: ActivityPerson
  // The view with the person taken out, which Clear person opens.
  without: ActivityFilter
}

// Same-email accounts are a pointer, not a merged view: the timeline is this one account (decided on #44).
export const PersonCard = ({ person, without }: PersonCardProps) => (
  <section className="df-person-card" aria-label={person.name}>
    <Tile name={person.name} large neutral />
    <div className="df-person-card-name">
      <strong>{person.name}</strong>
      <span className="df-muted">{fill(words.kindLine, { email: person.email, kind: messages.activity.personKinds[person.kind] })}</span>
      {person.sameEmailAccounts > 0 && (
        <span className="df-person-card-pointer">{fill(plural(words.sameEmail, person.sameEmailAccounts), { count: formatCount(person.sameEmailAccounts) })}</span>
      )}
    </div>
    <ul className="df-person-card-places" aria-label={fill(words.membershipsLabel, { name: person.name })}>
      {person.memberships.map((membership) => (
        <li key={`${membership.where}-${membership.role}`}>
          {membership.where} · {membership.role}
        </li>
      ))}
    </ul>
    <Link to="/activity" search={without} className="df-row-link">
      {words.clear}
    </Link>
  </section>
)
