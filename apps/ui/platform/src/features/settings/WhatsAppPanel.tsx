import { ConfirmDialog, ErrorState, LoadingState, PermissionDenied, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { Fragment, useEffect, useId, useState } from 'react'
import {
  loadWhatsApp,
  removeWhatsApp,
  saveWhatsApp,
  setWhatsAppChoice,
  setWhatsAppEnabled,
  testWhatsApp,
  type WhatsAppAccount,
  type WhatsAppChoice,
  type WhatsAppRefusal,
  type WhatsAppResult,
  type WhatsAppStatus,
} from '../../api/whatsapp'
import { servesCodes, whatsAppAccountInput, whatsAppMessages, type WhatsAppMessage, type WhatsAppRejection } from '@dripfunnel/shared/messaging'
import { fill, locale, messages } from '../../messages'

const words = messages.settings.integrations.whatsapp
const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
const look: Record<WhatsAppAccount['status'], [StatusTone, StatusIconName]> = { ok: ['success', 'ok'], untested: ['neutral', 'clock'], rejected: ['danger', 'cross'] }

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: WhatsAppStatus }
type Names = { language: string; templates: Partial<Record<WhatsAppMessage, string>> }

const namesOf = (account: WhatsAppAccount): Names => ({
  language: account.language ?? '',
  templates: Object.fromEntries(account.templates.flatMap((t) => (t.name ? [[t.message, t.name]] : []))),
})

// What Meta refused, by name: the token, the number, the business account, or which template in which language.
const problemText = (rejection: WhatsAppRejection, names: Names): string =>
  rejection.problem === 'template'
    ? fill(words.problems.template, { name: names.templates[rejection.template] ?? '', language: names.language, message: words.messages[rejection.template] })
    : words.problems[rejection.problem]

const refusalText = (r: { reason: WhatsAppRefusal; rejection: WhatsAppRejection | null }, names: Names): string =>
  r.reason === 'KEY_REJECTED' && r.rejection ? problemText(r.rejection, names) : words.refusals[r.reason]

const SaveDialog = ({ current, needsCode, onDone, onCancel }: { current: WhatsAppAccount | null; needsCode: boolean; onDone: () => void; onCancel: () => void }) => {
  const ids = { business: useId(), phone: useId(), token: useId(), language: useId(), template: useId() }
  const [businessAccountId, setBusinessAccountId] = useState(current?.businessAccountId ?? '')
  const [phoneNumberId, setPhoneNumberId] = useState(current?.phoneNumberId ?? '')
  const [token, setToken] = useState('')
  const [language, setLanguage] = useState(current?.language ?? 'en')
  const [templates, setTemplates] = useState<Record<WhatsAppMessage, string>>(() => {
    const named = current ? namesOf(current).templates : {}
    return { 'code.portal': named['code.portal'] ?? '', 'cart.reminder': named['cart.reminder'] ?? '', 'cart.reminder_code': named['cart.reminder_code'] ?? '' }
  })
  const [error, setError] = useState<string | null>(null)
  const input = whatsAppAccountInput({ businessAccountId, phoneNumberId, accessToken: token, language }, templates)
  const blocked = !input ? words.dialog.incomplete : needsCode && templates['code.portal'].trim() === '' ? words.dialog.codeTemplateNeeded : null
  const save = () => {
    if (!input) return
    setError(null)
    saveWhatsApp(input).then(
      (r) => {
        if (r.ok) return onDone()
        setError(r.reason === 'NO_CODE_TEMPLATE' ? words.dialog.codeTemplateNeeded : refusalText(r, { language: input.language, templates: Object.fromEntries(input.templates.map((t) => [t.message, t.name])) }))
      },
      () => setError(words.toasts.failed),
    )
  }
  const field = (id: string, label: string, hint: string, value: string, onChange: (value: string) => void, secret = false) => (
    <div className="df-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} maxLength={secret ? 2048 : 512} value={value} onChange={(event) => onChange(event.target.value)} />
      <p className="df-field-hint">{hint}</p>
    </div>
  )
  return (
    <ConfirmDialog
      open
      wide
      title={words.dialog.title}
      target={words.dialog.target}
      consequence={words.dialog.consequence}
      confirmLabel={words.dialog.save}
      cancelLabel={messages.settings.integrations.cancel}
      blocked={blocked}
      error={error}
      onConfirm={save}
      onCancel={onCancel}
    >
      {field(ids.business, words.businessAccountLabel, words.dialog.businessAccountHint, businessAccountId, setBusinessAccountId)}
      {field(ids.phone, words.phoneNumberLabel, words.dialog.phoneNumberHint, phoneNumberId, setPhoneNumberId)}
      {field(ids.token, words.tokenLabel, words.dialog.tokenHint, token, setToken, true)}
      {field(ids.language, words.languageLabel, words.dialog.languageHint, language, setLanguage)}
      {whatsAppMessages.map((message) => (
        <Fragment key={message}>{field(`${ids.template}-${message}`, words.messages[message], words.dialog.templateHints[message], templates[message], (value) => setTemplates((t) => ({ ...t, [message]: value })))}</Fragment>
      ))}
    </ConfirmDialog>
  )
}

export interface WhatsAppPanelProps {
  // False for a read-only console: the account shows, nothing changes.
  mayChange: boolean
  // Why an impersonation can't use it, or null: every WhatsApp field is refused to one, the read included (ACCESS §8.1).
  blocked: string | null
  onToast: (message: string) => void
}

// Integrations, WhatsApp (#1505): drawn from the tab's own parts, as Google sign-in is (docs/ui/platform/FIRST-RELEASE.md §14.5).
export const WhatsAppPanel = ({ mayChange, blocked, onToast }: WhatsAppPanelProps) => {
  const noteId = useId()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState<'save' | 'on' | 'off' | 'remove' | 'choice' | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [rejection, setRejection] = useState<WhatsAppRejection | null>(null)
  useEffect(() => {
    if (blocked) return
    let current = true
    loadWhatsApp().then(
      (status) => current && setLoaded({ state: 'ready', status }),
      () => current && setLoaded({ state: 'error' }),
    )
    return () => {
      current = false
    }
  }, [attempt, blocked])
  const reload = () => setAttempt((n) => n + 1)
  const header = (pill: boolean | null) => (
    <>
      <div className="df-settings-row-actions">
        <h2 id="settings-whatsapp">{words.title}</h2>
        {pill !== null && <StatusPill tone={pill ? 'success' : 'neutral'} icon={pill ? 'ok' : 'ban'} label={pill ? words.on : words.off} />}
      </div>
      <p className="df-muted">{words.note}</p>
    </>
  )
  if (blocked)
    return (
      <section className="df-panel df-panel--wide" aria-labelledby="settings-whatsapp">
        {header(null)}
        <PermissionDenied actionLabel={words.setUp} reason={blocked} />
      </section>
    )
  if (loaded.state === 'loading') return <LoadingState label={words.loading} rows={2} />
  if (loaded.state === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => (setLoaded({ state: 'loading' }), reload()) }} />
  const { enabled, account, dripfunnel, choice, sender } = loaded.status
  const names = account ? namesOf(account) : { language: '', templates: {} }
  const ours = sender === 'dripfunnel'
  // DripFunnel's account already carries codes; the partner's own needs code.portal named and Working (ACCESS §4).
  const canTurnOn = ours || (account !== null && servesCodes(account))
  // Why On isn't offered yet, also what the disabled Turn on points to.
  const why = ours ? null : account?.status === 'rejected' ? words.rejectedNote : account && !enabled && !canTurnOn ? words.needsCodeTemplate : null
  const openDialog = (kind: 'save' | 'on' | 'off' | 'remove' | 'choice') => (setDialogError(null), setOpen(kind))
  const senderText = ours ? words.sender.ours : sender === 'own' ? words.sender.own : words.sender.none
  // Choosing their own while On needs it to carry codes, as Turn on does; the API refuses it too.
  const choiceError = (picked: string) => (picked === 'own' && enabled && account && !servesCodes(account) ? words.refusals.NO_CODE_TEMPLATE : null)
  const test = () => {
    setTesting(true)
    testWhatsApp()
      .then(
        (r) => {
          if (!r.ok) return onToast(refusalText(r, names))
          setRejection(r.status === 'rejected' ? r.rejection : null)
          onToast(r.status === 'rejected' ? (enabled && !ours ? words.toasts.rejectedOff : words.toasts.rejected) : words.toasts.ok)
        },
        () => onToast(words.toasts.failed),
      )
      .finally(() => {
        setTesting(false)
        reload()
      })
  }
  // Each confirmed change: its toast and a fresh read, or its refusal in words with the dialog left open.
  const confirm = (work: () => Promise<WhatsAppResult>, done: string) => () => {
    setDialogError(null)
    work().then(
      (r) => {
        if (!r.ok) return setDialogError(refusalText(r, names))
        setOpen(null)
        setRejection(null)
        onToast(done)
        reload()
      },
      () => setDialogError(words.toasts.failed),
    )
  }
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="settings-whatsapp" aria-busy={testing}>
      {header(enabled)}
      {account ? (
        <ul className="df-settings-keys">
          <li>
            <div className="df-settings-onfile">
              <strong>{words.businessAccountLabel}</strong>
              <code>{account.businessAccountId}</code>
            </div>
            <div className="df-settings-onfile">
              <strong>{words.phoneNumberLabel}</strong>
              <code>{account.phoneNumberId}</code>
            </div>
            <div className="df-settings-onfile">
              <strong>{words.tokenLabel}</strong>
              <span className="df-muted">{account.hint}</span>
            </div>
            <div className="df-settings-onfile">
              <strong>{words.languageLabel}</strong>
              <code>{account.language}</code>
            </div>
            <div className="df-settings-onfile">
              <StatusPill tone={look[account.status][0]} icon={look[account.status][1]} label={words.statuses[account.status]} />
              <span className="df-muted">{account.lastTestedAt ? fill(words.lastTested, { when: when.format(new Date(account.lastTestedAt)) }) : words.neverTested}</span>
            </div>
          </li>
          <li>
            <strong>{words.templatesLabel}</strong>
            {account.templates.map((t) => (
              <div key={t.message} className="df-settings-onfile">
                <span>{words.messages[t.message]}</span>
                {t.name ? <code>{t.name}</code> : <span className="df-muted">{words.notUsed}</span>}
              </div>
            ))}
          </li>
        </ul>
      ) : (
        <p className="df-muted">{dripfunnel ? words.noneOurs : words.none}</p>
      )}
      {dripfunnel && (
        <div className="df-settings-onfile">
          <strong>{words.sender.label}</strong>
          <span>{senderText}</span>
          {mayChange && (
            <button type="button" className="df-button" disabled={testing} onClick={() => openDialog('choice')}>
              {words.choiceDialog.change}
            </button>
          )}
        </div>
      )}
      {dripfunnel && <p className="df-muted">{words.available}</p>}
      {rejection && account?.status === 'rejected' && <p role="alert">{problemText(rejection, names)}</p>}
      {why && (
        <p id={noteId} className="df-muted">
          {why}
        </p>
      )}
      {mayChange && (
        <div className="df-settings-row-actions">
          <button type="button" className={account ? 'df-button' : 'df-button df-button--primary'} disabled={testing} onClick={() => openDialog('save')}>
            {account ? words.replace : words.setUp}
          </button>
          {account && (
            <button type="button" className="df-button" disabled={testing} onClick={test}>
              {testing ? words.testing : words.test}
            </button>
          )}
          {(account || dripfunnel || enabled) &&
            (enabled ? (
              <button type="button" className="df-button" disabled={testing} onClick={() => openDialog('off')}>
                {words.turnOff}
              </button>
            ) : (
              <button type="button" className="df-button df-button--primary" disabled={testing || !canTurnOn} aria-describedby={why ? noteId : undefined} onClick={() => openDialog('on')}>
                {words.turnOn}
              </button>
            ))}
          {account && (
            <button type="button" className="df-button" disabled={testing} onClick={() => openDialog('remove')}>
              {words.remove}
            </button>
          )}
        </div>
      )}
      {open === 'save' && (
        <SaveDialog
          current={account}
          needsCode={enabled && !(dripfunnel && choice === 'dripfunnel')}
          onDone={() => {
            setOpen(null)
            setRejection(null)
            onToast(words.toasts.saved)
            reload()
          }}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === 'on' && (
        <ConfirmDialog
          open
          title={words.onDialog.title}
          target={words.onDialog.target}
          consequence={ours ? words.onDialog.consequenceOurs : words.onDialog.consequence}
          confirmLabel={words.onDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          error={dialogError}
          onConfirm={confirm(() => setWhatsAppEnabled(true), words.toasts.on)}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === 'off' && (
        <ConfirmDialog
          open
          danger
          title={words.offDialog.title}
          target={words.offDialog.target}
          consequence={words.offDialog.consequence}
          confirmLabel={words.offDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          error={dialogError}
          onConfirm={confirm(() => setWhatsAppEnabled(false), words.toasts.off)}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === 'remove' && (
        <ConfirmDialog
          open
          danger
          title={words.removeDialog.title}
          target={words.removeDialog.target}
          consequence={dripfunnel ? words.removeDialog.consequenceOurs : words.removeDialog.consequence}
          confirmLabel={words.removeDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          error={dialogError}
          onConfirm={confirm(removeWhatsApp, words.toasts.removed)}
          onCancel={() => setOpen(null)}
        />
      )}
      {open === 'choice' && (
        <ConfirmDialog
          open
          title={words.choiceDialog.title}
          target=""
          consequence={(_, picked) => (picked.account === 'dripfunnel' ? words.choiceDialog.consequenceOurs : account ? words.choiceDialog.consequenceOwn : words.choiceDialog.consequenceNoOwn)}
          confirmLabel={words.choiceDialog.confirm}
          cancelLabel={messages.settings.integrations.cancel}
          choices={[
            {
              key: 'account',
              label: words.choiceDialog.label,
              options: [
                { value: 'own', label: words.choiceDialog.own, hint: account ? words.choiceDialog.ownHint : words.choiceDialog.ownMissing },
                { value: 'dripfunnel', label: words.choiceDialog.ours, hint: words.choiceDialog.oursHint },
              ],
              initial: choice ?? (ours ? 'dripfunnel' : 'own'),
              error: choiceError,
            },
          ]}
          error={dialogError}
          onConfirm={(_, __, picked) => {
            const next: WhatsAppChoice = picked.account === 'dripfunnel' ? 'dripfunnel' : 'own'
            confirm(() => setWhatsAppChoice(next), next === 'dripfunnel' ? words.toasts.chosenOurs : words.toasts.chosenOwn)()
          }}
          onCancel={() => setOpen(null)}
        />
      )}
    </section>
  )
}
