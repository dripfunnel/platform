import { firstName, SessionControls, sessionControls, useCurrentStaffSession } from '@dripfunnel/shared/ui'
import { staffSession } from '../../api/staffSession'
import { fill, messages } from '../../messages'
import { ScreenPlaceholder } from '../shell/ScreenPlaceholder'

const items = sessionControls.map((control) => ({ control, label: messages.controls[control] }))

// Settings until its card (next batch): the placeholder, plus what a staff session can't change,
// turned off with the reason (#46), so the setup-session rules stay visible in the console.
export const SettingsPlaceholder = () => {
  const session = useCurrentStaffSession(staffSession)
  return (
    <>
      <ScreenPlaceholder screen="settings" />
      <section aria-labelledby="account" className="df-page">
        <h2 id="account">{messages.settings.account}</h2>
        <p className="df-page-lede">{messages.settings.accountSub}</p>
        <SessionControls
          session={session}
          items={items}
          reason={(block, current) => fill(messages.blocked[block], { user: current.actingAs ? firstName(current.actingAs.name) : '', partner: current.partnerName })}
        />
      </section>
    </>
  )
}
