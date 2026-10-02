import type { ReactNode } from 'react'
import './list.css'

export interface ListHeaderProps {
  level?: string
  title: string
  sub: string
  action?: ReactNode
}

export const ListHeader = ({ level, title, sub, action }: ListHeaderProps) => (
  <header className="df-list-header">
    <div className="df-list-heading">
      {level && <p className="df-eyebrow">{level}</p>}
      <h1 className="df-page-title">{title}</h1>
      <p className="df-page-lede">{sub}</p>
    </div>
    {action}
  </header>
)
