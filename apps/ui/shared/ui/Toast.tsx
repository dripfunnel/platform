import { useEffect } from 'react'
import './detail.css'

// design.md §4: bottom centre, one line, 4.2 s. No action, so no undo (decided on #19).
const toastMs = 4200

export interface ToastProps {
  message: string | null
  onDone: () => void
}

// The region is always there, so a screen reader hears each new message as it arrives.
export const Toast = ({ message, onDone }: ToastProps) => {
  useEffect(() => {
    if (message === null) return
    const timer = setTimeout(onDone, toastMs)
    return () => clearTimeout(timer)
  }, [message, onDone])
  return (
    <div className="df-toast-region" role="status">
      {message && <p className="df-toast">{message}</p>}
    </div>
  )
}
