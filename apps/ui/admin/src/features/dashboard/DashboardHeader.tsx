import { messages } from '../../messages'
import './dashboard.css'

const words = messages.dashboard

export const DashboardHeader = ({ sub }: { sub: string }) => (
  <header className="df-dashboard-header">
    <p className="df-eyebrow">{words.level}</p>
    <h1 className="df-page-title">{words.title}</h1>
    <p className="df-page-lede">{sub}</p>
  </header>
)
