import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import './shell.css'
import './states.css'

// A row as one role sees it, already worded by the app: label, and the badge only when work
// is waiting, with its spoken label ("3 need attention").
export interface NavRowView {
  key: string
  to: string
  icon: IconName
  label: string
  badge?: { count: string; label: string }
  /** A heading the row sits under ("Catalogue"): consecutive rows with one heading form a group. */
  group?: string
  /** Quiet text at the row's end, never work waiting ("7 days left"). */
  note?: string
}

export interface SideNavProps {
  rows: readonly NavRowView[]
  variant: 'bar' | 'drawer'
  label: string
  /** Nothing below the rows when null (the merchant portal names no product there). */
  footer: ReactNode
  onNavigate?: () => void
}

const groupsOf = (rows: readonly NavRowView[]): { heading: string | null; rows: NavRowView[] }[] =>
  rows.reduce<{ heading: string | null; rows: NavRowView[] }[]>((groups, row) => {
    const last = groups.at(-1)
    const heading = row.group ?? null
    if (last && last.heading === heading) last.rows.push(row)
    else groups.push({ heading, rows: [row] })
    return groups
  }, [])

const Row = ({ row, onNavigate }: { row: NavRowView; onNavigate?: (() => void) | undefined }) => (
  <li>
    <Link to={row.to} className="df-nav-row" title={row.label} activeProps={{ 'aria-current': 'page' }} onClick={onNavigate}>
      <Icon name={row.icon} />
      <span className="df-nav-label">{row.label}</span>
      {row.badge && (
        <span className="df-nav-badge">
          <span aria-hidden="true">{row.badge.count}</span>
          <span className="df-visually-hidden">{row.badge.label}</span>
        </span>
      )}
      {row.note && <span className="df-nav-note">{row.note}</span>}
    </Link>
  </li>
)

export const SideNav = ({ rows, variant, label, footer, onNavigate }: SideNavProps) => (
  <nav aria-label={label} className={`df-sidenav df-sidenav--${variant}`}>
    {groupsOf(rows).map((group) =>
      group.heading ? (
        <section key={group.heading} aria-label={group.heading}>
          <h2 className="df-nav-group">{group.heading}</h2>
          <ul>
            {group.rows.map((row) => (
              <Row key={row.key} row={row} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      ) : (
        <ul key={group.rows[0]?.key ?? 'rows'}>
          {group.rows.map((row) => (
            <Row key={row.key} row={row} onNavigate={onNavigate} />
          ))}
        </ul>
      ),
    )}
    {footer && <p className="df-nav-footer">{footer}</p>}
  </nav>
)
