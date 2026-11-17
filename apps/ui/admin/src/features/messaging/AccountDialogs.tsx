import { smsAccountInput, smsMessages, smsSecretFields, whatsAppAccountInput, whatsAppMessages, type SmsAccountInput, type SmsField, type SmsMessage, type SmsProvider, type WhatsAppAccountInput, type WhatsAppMessage } from '@dripfunnel/shared/messaging'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useId, useState } from 'react'
import type { PlatformWhatsAppAccount } from '../../api/messaging'
import { fill, messages } from '../../messages'
import { providerName } from './Messaging'

const words = messages.messaging
const sms = words.sms
const wa = words.whatsapp

interface DialogProps<Input> {
  error: string | null
  onSave: (input: Input, reason: string) => void
  onCancel: () => void
}

const Field = ({ id, label, hint, value, secret, maxLength, onChange }: { id: string; label: string; hint?: string; value: string; secret: boolean; maxLength: number; onChange: (value: string) => void }) => (
  <div className="df-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} maxLength={maxLength} value={value} onChange={(event) => onChange(event.target.value)} />
    {hint && <p className="df-field-hint">{hint}</p>}
  </div>
)

/** DripFunnel's account with one SMS provider, typed in full on every save: the API reads back no field but the hint. */
export const SmsAccountDialog = ({ provider, error, onSave, onCancel }: DialogProps<SmsAccountInput> & { provider: SmsProvider }) => {
  const prefix = useId()
  const [values, setValues] = useState<Partial<Record<SmsField, string>>>({})
  const [templates, setTemplates] = useState<Partial<Record<SmsMessage, string>>>({})
  const input = smsAccountInput(provider, values, templates)
  const name = providerName(provider)
  const field = (f: SmsField) => (
    <Field key={f} id={`${prefix}-${f}`} label={sms.fields[f]} hint={sms.dialog.hints[f]} value={values[f] ?? ''} secret={smsSecretFields.includes(f)} maxLength={80} onChange={(value) => setValues((v) => ({ ...v, [f]: value }))} />
  )
  const templateFields = smsMessages.map((message) => (
    <Field key={message} id={`${prefix}-${message}`} label={sms.messages[message]} value={templates[message] ?? ''} secret={false} maxLength={64} onChange={(value) => setTemplates((t) => ({ ...t, [message]: value }))} />
  ))
  return (
    <ConfirmDialog
      open
      wide
      title={fill(sms.dialog.title, { provider: name })}
      target=""
      consequence={fill(sms.dialog.consequence, { provider: name })}
      confirmLabel={sms.dialog.save}
      cancelLabel={words.cancel}
      reason={{ label: words.reason.label, hint: words.reason.hint }}
      blocked={input ? null : sms.dialog.incomplete[provider]}
      error={error}
      onConfirm={(reason) => input && onSave(input, reason ?? '')}
      onCancel={onCancel}
    >
      <div className="df-messaging-dialog">
        {provider === 'msg91' && [field('authKey'), <p key="templates" className="df-muted">{sms.dialog.templatesMsg91}</p>, ...templateFields]}
        {provider === 'twilio' && [field('accountSid'), field('authToken'), field('messagingServiceSid')]}
        {provider === 'sns' && [field('accessKeyId'), field('secretAccessKey'), field('region'), <p key="india" className="df-muted">{sms.dialog.indiaSns}</p>, field('senderId'), field('entityId'), ...templateFields]}
      </div>
    </ConfirmDialog>
  )
}

/** DripFunnel's WhatsApp Business account: the IDs and names start as saved; the token is typed again every time. */
export const WhatsAppAccountDialog = ({ current, enabled, error, onSave, onCancel }: DialogProps<WhatsAppAccountInput> & { current: PlatformWhatsAppAccount | null; enabled: boolean }) => {
  const prefix = useId()
  const [businessAccountId, setBusinessAccountId] = useState(current?.businessAccountId ?? '')
  const [phoneNumberId, setPhoneNumberId] = useState(current?.phoneNumberId ?? '')
  const [accessToken, setAccessToken] = useState('')
  const [language, setLanguage] = useState(current?.language ?? 'en')
  const [names, setNames] = useState<Partial<Record<WhatsAppMessage, string>>>(() => Object.fromEntries((current?.templates ?? []).flatMap((t) => (t.name ? [[t.message, t.name]] : []))))
  const input = whatsAppAccountInput({ businessAccountId, phoneNumberId, accessToken, language }, names)
  // While on, partners' codes may go through it, so the API refuses a save without code.portal.
  const blocked = !input ? wa.dialog.incomplete : enabled && !names['code.portal']?.trim() ? wa.dialog.codeTemplateNeeded : null
  return (
    <ConfirmDialog
      open
      wide
      title={wa.dialog.title}
      target=""
      consequence={wa.dialog.consequence}
      confirmLabel={wa.dialog.save}
      cancelLabel={words.cancel}
      reason={{ label: words.reason.label, hint: words.reason.hint }}
      blocked={blocked}
      error={error}
      onConfirm={(reason) => input && onSave(input, reason ?? '')}
      onCancel={onCancel}
    >
      <div className="df-messaging-dialog">
        <Field id={`${prefix}-business`} label={wa.businessAccountLabel} hint={wa.dialog.businessAccountHint} value={businessAccountId} secret={false} maxLength={512} onChange={setBusinessAccountId} />
        <Field id={`${prefix}-phone`} label={wa.phoneNumberLabel} hint={wa.dialog.phoneNumberHint} value={phoneNumberId} secret={false} maxLength={512} onChange={setPhoneNumberId} />
        <Field id={`${prefix}-token`} label={wa.tokenLabel} hint={wa.dialog.tokenHint} value={accessToken} secret maxLength={2048} onChange={setAccessToken} />
        <Field id={`${prefix}-language`} label={wa.languageLabel} hint={wa.dialog.languageHint} value={language} secret={false} maxLength={512} onChange={setLanguage} />
        {whatsAppMessages.map((message) => (
          <Field key={message} id={`${prefix}-${message}`} label={wa.messages[message]} hint={wa.dialog.templateHints[message]} value={names[message] ?? ''} secret={false} maxLength={512} onChange={(value) => setNames((n) => ({ ...n, [message]: value }))} />
        ))}
      </div>
    </ConfirmDialog>
  )
}
