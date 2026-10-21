import { Icon, UserMenu, type Environment } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import '@dripfunnel/shared/ui/states.css'
import { Link } from '@tanstack/react-router'
import type { Me } from '../../api/me'
import logo from '../../assets/dripfunnel-logo-inverse.svg'
import { fill, messages } from '../../messages'
import { SearchButton } from './SearchButton'

const words = messages.shell

export interface AppHeaderProps {
  me: Me
  environment: Environment
  menuOpen: boolean
  onOpenMenu: () => void
}

export const AppHeader = ({ me, environment, menuOpen, onOpenMenu }: AppHeaderProps) => {
  const role = words.roles[me.role]
  return (
    <header className="df-header">
      <button
        type="button"
        className="df-menu-button"
        aria-label={words.openMenu}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
      >
        <Icon name="menu" size={20} />
      </button>
      <Link to="/dashboard" className="df-logo" aria-label={words.homeLink}>
        <img src={logo} alt="" height={22} />
      </Link>
      <span className="df-product-label">{words.productLabel}</span>
      <span className={`df-env-pill df-env-pill--${environment}`}>{words.environment[environment].name}</span>
      <SearchButton />
      <a className="df-help" href={words.helpUrl} target="_blank" rel="noopener noreferrer">
        {words.help}
        <span className="df-visually-hidden"> {words.opensInNewTab}</span>
      </a>
      <UserMenu
        name={me.name}
        email={me.email}
        roleLabel={role}
        words={{ buttonLabel: fill(words.userMenu.label, { name: me.name, role }), theme: words.userMenu.theme }}
        themeStorageKey="df-admin-theme"
        // My activity is the staff member's own timeline, for every role (decided on #45). Sign out
        // is a stand-in until #13 adds the Admin API's sign-out, which ends the session and logs it.
        items={[
          { key: 'activity', label: words.userMenu.myActivity, to: '/activity', search: { person: me.id } },
          { key: 'signOut', label: words.userMenu.signOut, to: '/sign-in' },
        ]}
      />
    </header>
  )
}
