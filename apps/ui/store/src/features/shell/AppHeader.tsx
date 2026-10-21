import { Icon, initials, UserMenu } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { Brand } from '../../api/brand'
import { signOut, type Me, type StoreChoice } from '../../api/shell'
import logo from '../../assets/dripfunnel-logo-inverse.svg'
import { fill, messages } from '../../messages'
import type { Seat } from '../../nav'
import { StoreSwitcher } from './StoreSwitcher'

const words = messages.shell

export interface AppHeaderProps {
  me: Me
  seat: Seat
  current: StoreChoice
  stores: readonly StoreChoice[]
  brand: Brand | null
  menuOpen: boolean
  onOpenMenu: () => void
}

// The prototype's header (FIRST-RELEASE.md §3.2): the partner's mark and name, or DripFunnel's logo
// when the partner has none; the store switcher; Help; the person with My profile, Switch store, Sign out.
export const AppHeader = ({ me, seat, current, stores, brand, menuOpen, onOpenMenu }: AppHeaderProps) => {
  const sub = seat.side === 'merchant' ? words.roles[seat.role] : (current.seller?.name ?? '')
  return (
    <header className="df-header">
      <button type="button" className="df-menu-button" aria-label={words.openMenu} aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onOpenMenu}>
        <Icon name="menu" size={20} />
      </button>
      <Link to="/home" className="df-logo" aria-label={words.homeLink}>
        {brand?.primaryColor ? (
          <>
            {brand.files.logoDark ? (
              <img className="df-brand-logo" src={brand.files.logoDark} alt={brand.productName} />
            ) : (
              <>
                <span className="df-brand-mark" aria-hidden="true">
                  {brand.files.mark ? <img src={brand.files.mark} alt="" /> : initials(brand.productName).slice(0, 1)}
                </span>
                <span className="df-brand-name">{brand.productName}</span>
              </>
            )}
          </>
        ) : (
          <>
            <img src={logo} alt={words.logoAlt} height={22} />
            <span className="df-product-label">{words.productLabel}</span>
          </>
        )}
      </Link>
      <StoreSwitcher current={current} stores={stores} />
      <a className="df-help" href={brand?.helpUrl ?? words.helpUrl} target="_blank" rel="noopener noreferrer">
        {words.help}
        <span className="df-visually-hidden"> {words.opensInNewTab}</span>
      </a>
      <UserMenu
        name={me.name}
        email={me.email}
        roleLabel={sub}
        words={{ buttonLabel: fill(words.userMenu.label, { name: me.name, role: sub }), theme: words.userMenu.theme }}
        themeStorageKey="df-store-theme"
        items={[
          { key: 'profile', label: words.userMenu.profile, to: '/profile' },
          // A Manager reads the store's log here; the Owner has it in Settings (FIRST-RELEASE §15).
          ...(seat.side === 'merchant' && seat.role === 'manager' ? [{ key: 'activity', label: words.userMenu.activity, to: '/activity' }] : []),
          { key: 'switch', label: words.userMenu.switchStore, to: '/stores' },
          { key: 'signOut', label: words.userMenu.signOut, to: '/sign-in', onSelect: signOut },
        ]}
      />
    </header>
  )
}
