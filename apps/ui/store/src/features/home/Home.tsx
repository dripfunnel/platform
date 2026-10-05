import { firstName, SessionControls, sessionControls, useCurrentStaffSession } from '@dripfunnel/shared/ui'
import { staffSession } from '../../api/staffSession'
import { fill, messages } from '../../messages'

const items = sessionControls.map((control) => ({ control, label: messages.controls[control] }))

// Home's own content is SAPI 18's and its card's; until then the account controls a staff session blocks.
export const Home = () => {
  const session = useCurrentStaffSession(staffSession)
  return (
    <div className="df-page">
      <h1 className="df-page-title">{messages.home.title}</h1>
      <section aria-labelledby="account">
        <h2 id="account">{messages.home.account}</h2>
        <p className="df-page-lede">{messages.home.accountSub}</p>
        <SessionControls
          session={session}
          items={items}
          reason={(block, current) => fill(messages.blocked[block], { user: current.actingAs ? firstName(current.actingAs.name) : '', partner: current.partnerName })}
        />
      </section>
    </div>
  )
}
