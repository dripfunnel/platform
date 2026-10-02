import type { Partner } from '../../api/partners'
import { messages } from '../../messages'
import { InfoNote } from '@dripfunnel/shared/ui'
import './partners.css'

const words = messages.partner

// The partner's own colours are its data, shown as swatches, never the console's styling.
const Swatch = ({ label, color }: { label: string; color: string }) => (
  <div className="df-swatch">
    <span className="df-swatch-chip" style={{ background: color }} aria-hidden="true" />
    <span>{label}</span>
    <code>{color}</code>
  </div>
)

export const BrandingTab = ({ partner }: { partner: Partner }) => {
  const { branding } = partner
  return (
    <div className="df-panels">
      <InfoNote>{words.readOnlyEdited}</InfoNote>
      <section className="df-panel df-panel--wide" aria-label={words.tabs.branding}>
        <dl className="df-facts">
          <dt>{words.branding.productName}</dt>
          <dd>{branding.productName}</dd>
          <dt>{words.branding.poweredBy}</dt>
          <dd>{words.branding.powered[branding.poweredBy]}</dd>
        </dl>
        <div className="df-swatches">
          <Swatch label={words.branding.primary} color={branding.primaryColor} />
          <Swatch label={words.branding.accent} color={branding.accentColor} />
        </div>
      </section>
    </div>
  )
}
