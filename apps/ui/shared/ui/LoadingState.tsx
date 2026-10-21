import type { ReactNode } from 'react'
import './states.css'
import { useAnnouncement } from './useAnnouncement'

export interface LoadingStateProps {
  label: string
  rows?: number
  // Skeletons shaped like the screen's own layout, in place of the plain rows.
  shape?: ReactNode
}

// Skeletons only, never a number: a zero that later becomes real reads as data (ui/README §6).
// No aria-busy, since a busy region is not read until it stops being busy.
export const LoadingState = ({ label, rows = 3, shape }: LoadingStateProps) => {
  const announcement = useAnnouncement(label)
  const status = (
    <p role="status" className="df-visually-hidden">
      {announcement}
    </p>
  )
  if (shape) {
    return (
      <div>
        {status}
        <div aria-hidden="true">{shape}</div>
      </div>
    )
  }
  return (
    <div className="df-state">
      {status}
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="df-skeleton" aria-hidden="true" />
      ))}
    </div>
  )
}
