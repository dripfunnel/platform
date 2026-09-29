import { useEffect, useState } from 'react'
import './states.css'

export interface LoadingStateProps {
  label: string
  rows?: number
}

// Skeletons only, never a number: a zero that later becomes real reads as data (ui/README §6).
// The status region mounts empty and receives the label after it is in the page: screen
// readers announce a change to a live region, not text it arrived with. No aria-busy, since a
// busy region is not read until it stops being busy.
export const LoadingState = ({ label, rows = 3 }: LoadingStateProps) => {
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    setAnnouncement(label)
  }, [label])
  return (
    <div className="df-state">
      <p role="status" className="df-visually-hidden">
        {announcement}
      </p>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="df-skeleton" aria-hidden="true" />
      ))}
    </div>
  )
}
