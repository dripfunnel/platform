import type { Branding } from '../../api/branding'
import { messages } from '../../messages'
import { impressumMissing, type BrandDraft, type DraftField } from './brandDraft'

const words = messages.branding.words

export interface WordsTabProps {
  draft: BrandDraft
  branding: Branding
  invalid: readonly DraftField[]
  disabled: boolean
  onChange: (next: Branding['words']) => void
}

type UrlField = 'supportUrl' | 'helpUrl' | 'termsUrl' | 'privacyUrl' | 'dpaUrl'
const urlFields: readonly UrlField[] = ['supportUrl', 'helpUrl', 'termsUrl', 'privacyUrl', 'dpaUrl']

// The words (§8.2): support, legal pages, the Impressum where the law asks, and "Powered by" as the contract allows.
export const WordsTab = ({ draft, branding, invalid, disabled, onChange }: WordsTabProps) => {
  const set = (patch: Partial<Branding['words']>) => onChange({ ...draft.words, ...patch })
  const fixed = branding.poweredBy.kind === 'fixedOn'
  return (
    <section className="df-panel df-brand-card" aria-label={messages.branding.tabs.words}>
      <div className="df-field">
        <label htmlFor="brand-support-email">{words.supportEmail}</label>
        <input id="brand-support-email" type="email" value={draft.words.supportEmail} maxLength={254} disabled={disabled} aria-invalid={invalid.includes('supportEmail')} aria-describedby={invalid.includes('supportEmail') ? 'brand-support-email-error' : undefined} onChange={(event) => set({ supportEmail: event.target.value })} />
        {invalid.includes('supportEmail') && (
          <p id="brand-support-email-error" className="df-field-hint df-brand-error">
            {words.emailInvalid}
          </p>
        )}
      </div>
      {urlFields.map((field) => (
        <div key={field} className="df-field">
          <label htmlFor={`brand-${field}`}>{words[field]}</label>
          <input id={`brand-${field}`} type="url" value={draft.words[field]} maxLength={200} disabled={disabled} aria-invalid={invalid.includes(field)} aria-describedby={invalid.includes(field) ? `brand-${field}-error` : field === 'dpaUrl' && branding.dpaRequired ? 'brand-dpa-note' : undefined} onChange={(event) => set({ [field]: event.target.value })} />
          {invalid.includes(field) && (
            <p id={`brand-${field}-error`} className="df-field-hint df-brand-error">
              {words.urlInvalid}
            </p>
          )}
          {field === 'dpaUrl' && branding.dpaRequired && !invalid.includes(field) && (
            <p id="brand-dpa-note" className="df-field-hint">
              {words.dpaNeeded}
            </p>
          )}
        </div>
      ))}
      {branding.impressumRequired && (
        <div className="df-field">
          <label htmlFor="brand-impressum">{words.impressum}</label>
          <textarea id="brand-impressum" rows={4} value={draft.words.impressum} maxLength={2000} disabled={disabled} aria-invalid={impressumMissing(draft, branding)} aria-describedby="brand-impressum-note" onChange={(event) => set({ impressum: event.target.value })} />
          <p id="brand-impressum-note" className={impressumMissing(draft, branding) ? 'df-field-hint df-brand-error' : 'df-field-hint'}>
            {words.impressumRequired}
          </p>
        </div>
      )}
      <div className="df-field">
        <label className="df-brand-check">
          <input type="checkbox" checked={draft.words.poweredBy} disabled={disabled || fixed} aria-describedby="brand-powered-note" onChange={(event) => set({ poweredBy: event.target.checked })} />
          {words.poweredBy}
        </label>
        <p id="brand-powered-note" className="df-field-hint">
          {fixed ? words.poweredFixed : words.poweredChoice}
        </p>
      </div>
    </section>
  )
}
