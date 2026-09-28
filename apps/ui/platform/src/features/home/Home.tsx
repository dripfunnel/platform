import { Button } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'

export const Home = () => (
  <main style={{ fontFamily: 'var(--df-font)', padding: 'var(--df-space-4)' }}>
    <h1>{messages.home.title}</h1>
    <Link to="/sign-in">
      <Button>{messages.home.signIn}</Button>
    </Link>
  </main>
)
