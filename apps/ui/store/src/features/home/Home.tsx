import { Button, firstName, SessionControls, sessionControls, useCurrentStaffSession } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { staffSession } from '../../api/staffSession'
import { fill, messages } from '../../messages'

const items = sessionControls.map((control) => ({ control, label: messages.controls[control] }))

export const Home = () => {
  const session = useCurrentStaffSession(staffSession)
  return (
    <main style={{ fontFamily: 'var(--df-font)', padding: 'var(--df-space-4)' }}>
      <h1>{messages.home.title}</h1>
      <Link to="/sign-in">
        <Button>{messages.home.signIn}</Button>
      </Link>
      <section aria-labelledby="account">
        <h2 id="account">{messages.home.account}</h2>
        <p>{messages.home.accountSub}</p>
        <SessionControls
          session={session}
          items={items}
          reason={(block, current) => fill(messages.blocked[block], { user: current.actingAs ? firstName(current.actingAs.name) : '', partner: current.partnerName })}
        />
      </section>
    </main>
  )
}
