import './stale.css'
import { useAnnouncement, Icon } from '@dripfunnel/shared/ui'

export interface StaleNoticeProps {
  title: string
  body: string
  refreshLabel: string
  onRefresh: () => void
}

// Data behind or the connection gone (ui/README §6 "Partial / stale"): the screen keeps showing
// what it has, and says how old it is. The notice arrives with the page, so it is announced
// through a separate status region, or a screen reader would read old numbers as current.
export const StaleNotice = ({ title, body, refreshLabel, onRefresh }: StaleNoticeProps) => {
  const announcement = useAnnouncement(`${title} ${body}`)
  return (
    <div className="df-stale">
      <Icon name="clock" size={16} strokeWidth={2} />
      <p>
        <strong>{title}</strong> {body}
      </p>
      <button type="button" className="df-stale-refresh" onClick={onRefresh}>
        {refreshLabel}
      </button>
      <p role="status" className="df-visually-hidden">
        {announcement}
      </p>
    </div>
  )
}
