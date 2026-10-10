import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useId, useState } from 'react'
import { createApiKey, keyNameMax, revokeApiKey, rotateApiKey, type ApiKey, type ApiKeyChoices } from '../../api/developers'
import { fill, formatCount, formatList, formatTime, messages, plural } from '../../messages'
import { refusalIn } from '../common/refusal'
import { SecretOnce } from './SecretOnce'
import { useFreshList } from './useFreshList'

const words = messages.settings.developers.keys
const refusalOf = refusalIn(words.refused)

/** The first scope a new key holds, as SetDev ticks "See products". */
const firstScope = 'catalog.read'
/** SetDev's default lifetime, when the API offers it. */
const defaultDays = 90

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

interface KeyForm {
  name: string
  scopes: readonly string[]
  supplierId: string
  /** Days, or '' for never. */
  expires: string
  error: string | null
}

export interface ApiKeysCardProps {
  initial: readonly ApiKey[]
  choices: ApiKeyChoices
  /** The store's active suppliers, which a key may be bound to. */
  suppliers: readonly { id: string; name: string }[]
  read: () => Promise<ApiKey[]>
  canEdit: boolean
  onToast: (text: string) => void
}

const scopeName = (scope: string): string => (words.scopes as Record<string, string>)[scope] ?? scope

const expiryOf = (key: ApiKey, now: number) => {
  if (!key.expiresAt) return { text: words.noExpiry, past: false }
  const past = Date.parse(key.expiresAt) <= now
  return { text: fill(past ? words.expired : words.expiresOn, { time: formatTime(key.expiresAt) }), past }
}

/** Developers › API keys (SetDev): make one with its scopes, supplier and lifetime, see its secret once, rotate or revoke it. */
export const ApiKeysCard = ({ initial, choices, suppliers, read, canEdit, onToast }: ApiKeysCardProps) => {
  const id = useId()
  const { list: keys, stale, refresh } = useFreshList(initial, read)
  const [form, setForm] = useState<KeyForm | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ro = !canEdit || busy
  const now = Date.now()

  const open = () => {
    setNote(null)
    setSecret(null)
    setForm({ name: '', scopes: choices.scopes.includes(firstScope) ? [firstScope] : [], supplierId: '', expires: choices.expiresInDays.includes(defaultDays) ? String(defaultDays) : '', error: null })
  }

  const create = async (f: KeyForm) => {
    const name = f.name.trim()
    const problem = name === '' ? words.nameMissing : f.scopes.length === 0 ? words.scopesMissing : null
    if (problem) return setForm({ ...f, error: problem })
    setForm({ ...f, error: null })
    setBusy(true)
    try {
      const issued = await createApiKey({ name, scopes: f.scopes, supplierId: f.supplierId || null, expiresInDays: f.expires ? Number(f.expires) : null })
      setForm(null)
      setSecret(issued.secret)
      onToast(fill(words.created, { name }))
      void refresh()
    } catch (error) {
      setForm({ ...f, error: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const act = async (work: () => Promise<string>) => {
    setBusy(true)
    setNote(null)
    setForm((f) => f && { ...f, error: null })
    try {
      onToast(await work())
      void refresh()
    } catch (error) {
      setNote(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  const askRotate = (key: ApiKey) =>
    setAsk({
      title: fill(words.rotateName, { name: key.name }) + '?',
      target: key.name,
      consequence: words.rotateBody,
      confirmLabel: words.rotateGo,
      onConfirm: () =>
        void act(async () => {
          const issued = await rotateApiKey(key.id)
          setForm(null)
          setSecret(issued.secret)
          return fill(words.rotated, { name: key.name })
        }),
    })

  const askRevoke = (key: ApiKey) =>
    setAsk({
      title: fill(words.revokeName, { name: key.name }) + '?',
      target: key.name,
      consequence: words.revokeBody,
      confirmLabel: words.revokeGo,
      danger: true,
      onConfirm: () => void act(async () => (await revokeApiKey(key.id), fill(words.revoked, { name: key.name }))),
    })

  const toggleScope = (f: KeyForm, scope: string) => setForm({ ...f, scopes: f.scopes.includes(scope) ? f.scopes.filter((s) => s !== scope) : [...f.scopes, scope], error: null })

  return (
    <section className="df-dev-section" aria-labelledby={`${id}-keys`}>
      <div className="df-dev-head">
        <div>
          <h2 id={`${id}-keys`} className="df-dev-h2">
            {words.title}
          </h2>
          <p className="df-set-sub">
            {words.sub} {fill(words.limits, { minute: formatCount(choices.requestsPerMinute), month: formatCount(choices.requestsPerMonth) })}
          </p>
        </div>
        <button type="button" className="df-button" disabled={ro || form !== null} onClick={open}>
          {words.create}
        </button>
      </div>
      {secret && <SecretOnce title={words.secretTitle} warning={words.secretWarn} secret={secret} onStored={() => setSecret(null)} />}
      {form && (
        <form
          className="df-set-card df-dev-new"
          aria-labelledby={`${id}-new`}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void create(form)
          }}
        >
          <h3 id={`${id}-new`} className="df-dev-h3">
            {words.newTitle}
          </h3>
          {form.error && (
            <p className="df-set-failure" role="alert">
              {form.error}
            </p>
          )}
          <div className="df-set-field">
            <label htmlFor={`${id}-name`}>{words.name}</label>
            <input id={`${id}-name`} value={form.name} maxLength={keyNameMax} placeholder={words.namePlaceholder} onChange={(event) => setForm({ ...form, name: event.target.value, error: null })} />
          </div>
          <fieldset className="df-dev-checks">
            <legend className="df-set-label">{words.can}</legend>
            {choices.scopes.map((scope) => (
              <label key={scope} className="df-tax-check">
                <input type="checkbox" checked={form.scopes.includes(scope)} onChange={() => toggleScope(form, scope)} />
                {scopeName(scope)}
              </label>
            ))}
          </fieldset>
          <div className="df-set-grid">
            <div className="df-set-field">
              <label htmlFor={`${id}-for`}>{words.worksFor}</label>
              <select id={`${id}-for`} value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value, error: null })}>
                <option value="">{words.wholeStore}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fill(words.onlySupplier, { name: s.name })}
                  </option>
                ))}
              </select>
              <span className="df-set-help">{form.supplierId ? words.supplierHelp : words.wholeHelp}</span>
            </div>
            <div className="df-set-field">
              <label htmlFor={`${id}-exp`}>{words.expires}</label>
              <select id={`${id}-exp`} value={form.expires} onChange={(event) => setForm({ ...form, expires: event.target.value, error: null })}>
                {choices.expiresInDays.map((days) => (
                  <option key={days} value={String(days)}>
                    {fill(plural(words.inDays, days), { count: formatCount(days) })}
                  </option>
                ))}
                <option value="">{words.never}</option>
              </select>
            </div>
          </div>
          <div className="df-dev-buttons">
            <button type="submit" className="df-button df-button--primary" disabled={busy}>
              {words.createKey}
            </button>
            <button type="button" className="df-button" disabled={busy} onClick={() => setForm(null)}>
              {messages.settings.developers.cancel}
            </button>
          </div>
        </form>
      )}
      {note && (
        <p className="df-set-failure" role="alert">
          {note}
        </p>
      )}
      {stale && (
        <p className="df-set-warning" role="status">
          {words.stale}
        </p>
      )}
      {keys.length === 0 ? (
        <p className="df-dev-empty">{words.empty}</p>
      ) : (
        <ul className="df-dev-table" aria-label={words.listLabel}>
          {keys.map((key) => {
            const expiry = expiryOf(key, now)
            const oldWorks = key.previousWorksUntil && Date.parse(key.previousWorksUntil) > now ? key.previousWorksUntil : null
            return (
              <li key={key.id} className="df-dev-key">
                <span className="df-dev-cell">
                  <strong>{key.name}</strong>
                  <span className="df-dev-mono">{fill(words.prefix, { prefix: key.prefix })}</span>
                </span>
                <span className="df-dev-cell">
                  <span>{formatList(key.scopes.map(scopeName))}</span>
                  <span className="df-dev-muted">{key.supplier ? fill(words.onlySupplier, { name: key.supplier.name }) : words.whole}</span>
                </span>
                <span className="df-dev-cell">
                  <span>{key.lastUsedAt ? fill(words.lastUsed, { time: formatTime(key.lastUsedAt) }) : words.neverUsed}</span>
                  <span className={key.createdByHere ? 'df-dev-muted' : 'df-dev-gone'}>
                    {key.createdByHere ? fill(words.by, { name: key.createdByName ?? '' }) : key.createdByName ? fill(words.byGone, { name: key.createdByName }) : words.byUnknown}
                  </span>
                </span>
                <span className="df-dev-cell">
                  <span className={expiry.past ? 'df-dev-gone' : 'df-dev-muted'}>{expiry.text}</span>
                  {oldWorks && <span className="df-dev-muted">{fill(words.oldWorks, { time: formatTime(oldWorks) })}</span>}
                </span>
                <span className="df-dev-actions">
                  <button type="button" className="df-set-link" disabled={ro} aria-label={fill(words.rotateName, { name: key.name })} onClick={() => askRotate(key)}>
                    {words.rotate}
                  </button>
                  <button type="button" className="df-set-link df-dev-danger" disabled={ro} aria-label={fill(words.revokeName, { name: key.name })} onClick={() => askRevoke(key)}>
                    {words.revoke}
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {ask && (
        <ConfirmDialog
          key={`${ask.title}|${ask.confirmLabel}`}
          {...ask}
          open
          cancelLabel={messages.settings.developers.cancel}
          onCancel={() => setAsk(null)}
          onConfirm={(...args) => {
            setAsk(null)
            ask.onConfirm(...args)
          }}
        />
      )}
    </section>
  )
}
