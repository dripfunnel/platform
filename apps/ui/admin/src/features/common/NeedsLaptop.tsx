import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import './phone.css'

const words = messages.phone.laptop

export const NeedsLaptop = () => (
  <div className="df-phone">
    <h1 className="df-phone-title">{words.title}</h1>
    <p className="df-phone-lede">{words.body}</p>
    <Link to="/stores" className="df-button df-button--primary df-phone-primary">
      {words.action}
    </Link>
  </div>
)
