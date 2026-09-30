import { messages } from '../../messages'
import './shell.css'

// An explicit placeholder, so every nav row and every Dashboard link resolves to a screen
// (docs/ui/README.md §5) until its card builds it: Partners #19, Stores #20.
export const ScreenPlaceholder = ({ title }: { title: string }) => (
  <div className="df-page">
    <h1 className="df-page-title">{title}</h1>
    <p className="df-page-lede">{messages.shell.placeholder}</p>
  </div>
)
