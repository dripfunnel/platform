import { Icon } from '@dripfunnel/shared/ui'
import './teamRow.css'

export interface TeamRowProps {
  mark: string
  square: boolean
  name: string
  sub: string
  role: string
  status: string
  tone: 'ok' | 'wait' | 'off' | 'quiet'
  onMenu: (() => void) | null
  menuLabel: string
}

/** One person or company on a team list: Settings › People and Supplier, and a supplier's Your team. */
export const TeamRow = ({ mark, square, name, sub, role, status, tone, onMenu, menuLabel }: TeamRowProps) => (
  <li className="df-team-row">
    <span className="df-team-who">
      <span className={square ? 'df-team-mark df-team-mark--company' : 'df-team-mark'} aria-hidden="true">
        {mark}
      </span>
      <span>
        <strong>{name}</strong>
        <span>{sub}</span>
      </span>
    </span>
    <span className="df-team-role">{role}</span>
    <span className={`df-team-status df-team-status--${tone}`}>{status}</span>
    {onMenu && (
      <button type="button" className="df-team-menu" aria-label={menuLabel} onClick={onMenu}>
        <Icon name="more" size={18} strokeWidth={3} />
      </button>
    )}
  </li>
)
