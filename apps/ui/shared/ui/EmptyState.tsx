import { useId, type ReactNode } from 'react'
import './states.css'

export interface EmptyStateProps {
  title: string
  body: string
  action?: ReactNode
}

export const EmptyState = ({ title, body, action }: EmptyStateProps) => {
  const titleId = useId()
  return (
    <section className="df-state" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      <p>{body}</p>
      {action && <div className="df-actions">{action}</div>}
    </section>
  )
}
