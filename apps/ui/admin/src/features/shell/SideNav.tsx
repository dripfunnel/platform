import { Link } from '@tanstack/react-router'
import type { NavBadges } from '../../api/navBadges'
import { fill, formatCount, messages } from '../../messages'
import type { NavItem } from '../../nav'
import '@dripfunnel/shared/ui/states.css'
import { Icon } from './Icon'
import './shell.css'

const words = messages.shell

export interface SideNavProps {
  rows: readonly NavItem[]
  badges: NavBadges
  variant: 'bar' | 'drawer'
  onNavigate?: () => void
}

export const SideNav = ({ rows, badges, variant, onNavigate }: SideNavProps) => (
  <nav aria-label={words.navLabel} className={`df-sidenav df-sidenav--${variant}`}>
    <ul>
      {rows.map((row) => {
        const label = messages.nav[row.key]
        const count = row.badge ? badges[row.badge] : 0
        return (
          <li key={row.key}>
            <Link
              to={row.to}
              className="df-nav-row"
              title={label}
              activeProps={{ 'aria-current': 'page' }}
              onClick={onNavigate}
            >
              <Icon name={row.icon} />
              <span className="df-nav-label">{label}</span>
              {row.badge && count > 0 && (
                <span className="df-nav-badge">
                  <span aria-hidden="true">{formatCount(count)}</span>
                  <span className="df-visually-hidden">
                    {fill(words.badges[row.badge], { count: formatCount(count) })}
                  </span>
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
    <p className="df-nav-footer">{words.navFooter}</p>
  </nav>
)
