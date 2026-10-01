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
}

export interface SideNavProps {
  rows: readonly NavRowView[]
  variant: 'bar' | 'drawer'
  label: string
  footer: ReactNode
  onNavigate?: () => void
}

export const SideNav = ({ rows, variant, label, footer, onNavigate }: SideNavProps) => (
  <nav aria-label={label} className={`df-sidenav df-sidenav--${variant}`}>
    <ul>
      {rows.map((row) => (
        <li key={row.key}>
          <Link to={row.to} className="df-nav-row" title={row.label} activeProps={{ 'aria-current': 'page' }} onClick={onNavigate}>
            <Icon name={row.icon} />
            <span className="df-nav-label">{row.label}</span>
            {row.badge && (
              <span className="df-nav-badge">
                <span aria-hidden="true">{row.badge.count}</span>
                <span className="df-visually-hidden">{row.badge.label}</span>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
    <p className="df-nav-footer">{footer}</p>
  </nav>
)
