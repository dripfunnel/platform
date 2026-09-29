import { Link } from '@tanstack/react-router'
import type { Me } from '../../api/me'
import logo from '../../assets/dripfunnel-logo-inverse.svg'
import { messages } from '../../messages'
import '../common/states.css'
import type { Environment } from './environment'
import { Icon } from './Icon'
import { SearchButton } from './SearchButton'
import './shell.css'
import { UserMenu } from './UserMenu'

const words = messages.shell
const helpUrl = 'https://help.dripfunnel.com/admin'

export interface AppHeaderProps {
  me: Me
  environment: Environment
  menuOpen: boolean
  onOpenMenu: () => void
}

export const AppHeader = ({ me, environment, menuOpen, onOpenMenu }: AppHeaderProps) => (
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
    <a className="df-help" href={helpUrl} target="_blank" rel="noopener noreferrer">
      {words.help}
      <span className="df-visually-hidden"> {words.opensInNewTab}</span>
    </a>
    <UserMenu me={me} />
  </header>
)
