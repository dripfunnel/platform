import { InfoNote } from '@dripfunnel/shared/ui'
import { fill, messages } from '../../messages'

const words = messages.settings.payout

// Payout and payment (§14.3). The provider isn't connected yet (#201), so nothing here is drawn
// as on file; the card form is the provider's hosted field, never an input of ours (THIRD-PARTY-ACCESS §2.7).
export const PayoutTab = ({ setupSession, partner }: { setupSession: boolean; partner: string }) => (
  <div className="df-panels">
    {setupSession ? <InfoNote>{fill(words.staffSession, { partner })}</InfoNote> : <InfoNote>{words.notConnected}</InfoNote>}
    <section className="df-panel" aria-labelledby="settings-payout">
      <h2 id="settings-payout">{words.payoutAccount}</h2>
      <p className="df-muted">{words.payoutNote}</p>
    </section>
    <section className="df-panel" aria-labelledby="settings-payment">
      <h2 id="settings-payment">{words.paymentMethod}</h2>
      <p className="df-muted">{words.paymentNote}</p>
      <div className="df-hosted-slot" role="group" aria-label={words.paymentMethod}>
        {words.slot}
      </div>
    </section>
  </div>
)
