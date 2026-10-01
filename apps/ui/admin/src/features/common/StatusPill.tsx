import { Icon, type StatusIconName } from '../shell/Icon'
import './list.css'

export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'solid'

// A status is never colour alone: every pill carries an icon and a word (designs/design.md §10).
export const StatusPill = ({ tone, icon, label }: { tone: StatusTone; icon: StatusIconName; label: string }) => (
  <span className={`df-pill df-pill--${tone}`}>
    <Icon name={icon} size={12} strokeWidth={2.4} />
    {label}
  </span>
)
