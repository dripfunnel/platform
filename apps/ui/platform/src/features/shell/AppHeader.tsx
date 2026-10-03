import { Icon, initials, UserMenu } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import '@dripfunnel/shared/ui/states.css'
import { Link } from '@tanstack/react-router'
import { signOut } from '../../api/auth'
import type { Me } from '../../api/me'
import logo from '../../assets/dripfunnel-logo-inverse.svg'
import { fill, messages } from '../../messages'
import './partner.css'
import { SearchPalette } from './SearchPalette'

const words = messages.shell

export interface AppHeaderProps {
  me: Me
  menuOpen: boolean
  onOpenMenu: () => void
}

// The prototype's header: DripFunnel's mark and "Partners", then the partner's name as "who
// you're signed in for" (FIRST-RELEASE.md §2.2). DripFunnel-branded, never the partner's look.
export const AppHeader = ({ me, menuOpen, onOpenMenu }: AppHeaderProps) => {
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
      <span className="df-for" title={fill(words.signedInFor, { partner: me.partner.name })}>
        <span className="df-for-initials" aria-hidden="true">
          {initials(me.partner.name)}
        </span>
        <span className="df-visually-hidden">{words.signedInForLabel} </span>
        <span className="df-for-name">{me.partner.name}</span>
      </span>
      <SearchPalette />
      <a className="df-help" href={words.helpUrl} target="_blank" rel="noopener noreferrer">
        {words.help}
        <span className="df-visually-hidden"> {words.opensInNewTab}</span>
      </a>
      <UserMenu
        name={me.name}
        email={me.email}
        roleLabel={role}
        words={{ buttonLabel: fill(words.userMenu.label, { name: me.name, role }), theme: words.userMenu.theme }}
        themeStorageKey="df-platform-theme"
        // My activity is the signed-in user's own timeline (FIRST-RELEASE.md §13).
        items={[
          { key: 'activity', label: words.userMenu.myActivity, to: '/activity', search: { person: me.id } },
          { key: 'signOut', label: words.userMenu.signOut, to: '/sign-in', onSelect: signOut },
        ]}
      />
    </header>
  )
}
