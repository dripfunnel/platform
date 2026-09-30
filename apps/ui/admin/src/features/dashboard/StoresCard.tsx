import { Link } from '@tanstack/react-router'
import type { DashboardData } from '../../api/dashboard'
import { fill, formatCount, messages } from '../../messages'
import { DashboardCard } from './DashboardCard'

const words = messages.dashboard.stores

export interface StoresCardProps {
  stores: DashboardData['stores']
  scope: { partner?: string }
}

export const StoresCard = ({ stores, scope }: StoresCardProps) => {
  const total = formatCount(stores.total)
  const newThisWeek = formatCount(stores.newThisWeek)
  return (
    <DashboardCard
      title={words.title}
      aside={
        <Link to="/stores" search={scope} className="df-card-link">
          {words.all}
        </Link>
      }
    >
      <Link to="/stores" search={scope} className="df-big-number" aria-label={fill(words.totalLabel, { count: total })}>
        {total}
      </Link>
      <p className="df-muted">
        {words.newThisWeek}{' '}
        <Link
          to="/stores"
          search={{ ...scope, created: '7d' }}
          className="df-strong-link"
          aria-label={fill(words.newThisWeekLabel, { count: newThisWeek })}
        >
          {newThisWeek}
        </Link>
      </p>
      <ul className="df-rows" aria-label={words.byPartner}>
        {stores.newThisWeekByPartner.map((partner) => {
          const count = formatCount(partner.count)
          return (
            <li key={partner.id}>
              <span>{partner.name}</span>
              <Link
                to="/stores"
                search={{ partner: partner.id, created: '7d' }}
                className="df-strong-link"
                aria-label={fill(words.byPartnerLabel, { partner: partner.name, count })}
              >
                {count}
              </Link>
            </li>
          )
        })}
      </ul>
    </DashboardCard>
  )
}
