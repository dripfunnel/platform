import { useId, type ReactNode } from 'react'
import './dashboard.css'

export interface DashboardCardProps {
  title: string
  aside?: ReactNode
  wide?: boolean
  children: ReactNode
}

export const DashboardCard = ({ title, aside, wide = false, children }: DashboardCardProps) => {
  const titleId = useId()
  return (
    <section className={wide ? 'df-card df-card--wide' : 'df-card'} aria-labelledby={titleId}>
      <div className="df-card-head">
        <h2 id={titleId}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
