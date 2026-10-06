import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, ErrorState, LoadingState, Toast, useScreenState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { useCallback, useEffect, useId, useState } from 'react'
import { deletePlace, loadPlaces, makeDefaultPlace, savePlace, type Place, type PlaceInput } from '../../api/stock'
import { harnessEnabled } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { placesSample, placesStates } from './placesStates'
import './warehouses.css'

const words = messages.warehouses

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; places: Place[] }
type Form = { id: string | null; revision: number | null; name: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string }

const blank: Form = { id: null, revision: null, name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: '' }

const formOf = (p: Place): Form => ({ id: p.id, revision: p.revision, name: p.name, line1: p.address?.line1 ?? '', line2: p.address?.line2 ?? '', city: p.address?.city ?? '', region: p.address?.region ?? '', postalCode: p.address?.postalCode ?? '', country: p.address?.country ?? '' })

/** The form as the API takes it: the name, and only the address lines given. */
export const placeInputOf = (f: Form): PlaceInput => {
  const address: PlaceInput['address'] = {}
  for (const key of ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const) {
    const value = f[key].trim()
    if (value) address[key] = key === 'country' ? value.toUpperCase() : value
  }
  return { name: f.name.trim(), address }
}

const addressLine = (p: Place) => [p.address?.line1, p.address?.city, p.address?.region, p.address?.country].filter(Boolean).join(', ')

const refusalOf = (error: unknown) => (isApiError(error) ? ((words.refused as Record<string, string>)[error.code] ?? words.refused.other) : words.refused.other)

const PlaceForm = ({ form, set, busy, onSave, onCancel }: { form: Form; set: (f: Form) => void; busy: boolean; onSave: () => void; onCancel: () => void }) => {
  const id = useId()
  // Opened from a button or a dialog: the form takes focus so its arrival is announced (WCAG 2.4.3).
  useEffect(() => document.getElementById(`${id}-name`)?.focus(), [id])
  const [tried, setTried] = useState(false)
  const nameMissing = form.name.trim() === ''
  const countryBad = form.country.trim() !== '' && !/^[A-Za-z]{2}$/.test(form.country.trim())
  const field = (key: keyof Omit<Form, 'id' | 'revision'>, label: string, extra: { placeholder?: string; problem?: string | null } = {}) => (
    <div className="df-places-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input id={`${id}-${key}`} value={form[key]} placeholder={extra.placeholder} maxLength={key === 'country' ? 2 : 120} aria-invalid={Boolean(extra.problem)} aria-describedby={extra.problem ? `${id}-${key}-problem` : undefined} onChange={(e) => set({ ...form, [key]: e.target.value })} />
      {extra.problem && <span id={`${id}-${key}-problem`} className="df-places-problem">{extra.problem}</span>}
    </div>
  )
  // Save says what's missing and goes to it, as the prototype's required name does, rather than sitting disabled.
  const trySave = () => {
    if (!nameMissing && !countryBad) return onSave()
    setTried(true)
    document.getElementById(`${id}-${nameMissing ? 'name' : 'country'}`)?.focus()
  }
  return (
    <section className="df-places-form" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{form.id ? fill(words.form.editTitle, { name: form.name }) : words.form.addTitle}</h3>
      {!form.id && <p className="df-places-hint">{words.form.addBody}</p>}
      <div className="df-places-grid">
        {field('name', words.form.name, { placeholder: words.form.namePlaceholder, problem: tried && nameMissing ? words.form.nameMissing : null })}
        {field('line1', words.form.line1)}
        {field('line2', words.form.line2)}
        {field('city', words.form.city)}
        {field('region', words.form.region)}
        {field('postalCode', words.form.postalCode)}
        {field('country', words.form.country, { problem: countryBad ? words.form.countryInvalid : null })}
      </div>
      <div className="df-places-actions">
        <button type="button" className="df-button" disabled={busy} onClick={onCancel}>
          {words.form.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={busy} onClick={trySave}>
          {form.id ? words.form.save : words.form.saveAdd}
        </button>
      </div>
    </section>
  )
}

/**
 * Where stock sits (SetOps "Warehouse"), the default first: a supplier's own inside "Your products" (#337), and the
 * merchant side's own with its suppliers' listed apart and read-only (`side`), each named by the API.
 */
export const WarehousesView = ({ canEdit, side }: { canEdit: boolean; side: 'merchant' | 'supplier' }) => {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const forced = useScreenState(placesStates, harnessEnabled)
  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    const sample = placesSample(forced)
    if (sample) return setView({ kind: 'ready', places: sample })
    void loadPlaces().then(
      (places) => setView({ kind: 'ready', places }),
      () => setView({ kind: 'error' }),
    )
  }, [forced])
  useEffect(load, [load])

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      setToast(await work())
      setForm(null)
    } catch (error) {
      setToast(refusalOf(error))
      // Saving again would only be refused again: the form closes, and the list reloads with their change.
      if (isApiError(error, 'STALE_REVISION')) setForm(null)
    } finally {
      setBusy(false)
      load()
    }
  }

  if (view.kind === 'loading') return <LoadingState label={words.loading} />
  if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />

  const save = (f: Form) =>
    void run(async () => {
      await savePlace(f.id, f.revision, placeInputOf(f))
      return f.id ? words.saved : fill(words.added, { name: f.name.trim() })
    })
  const manage = (p: Place) =>
    setAsk({
      title: p.name,
      target: addressLine(p) || p.name,
      consequence: (_, picks) => (picks['what'] === 'default' ? words.makeDefaultBody : picks['what'] === 'delete' ? words.deleteNext : words.editNext),
      confirmLabel: messages.editor.apply,
      choices: [
        {
          key: 'what',
          label: fill(words.manage, { name: p.name }),
          options: [...(p.isDefault ? [] : [{ value: 'default', label: words.makeDefault }]), { value: 'edit', label: words.edit }, ...(p.isDefault ? [] : [{ value: 'delete', label: words.delete }])],
          initial: p.isDefault ? 'edit' : 'default',
          error: () => null,
        },
      ],
      onConfirm: (_, __, picks) => {
        const what = picks['what']
        if (what === 'edit') return setForm(formOf(p))
        if (what === 'default')
          return void run(async () => {
            await makeDefaultPlace(p.id)
            return fill(words.madeDefault, { name: p.name })
          })
        if (p.units > 0) return setToast(fill(words.holdsStock, { name: p.name, count: fill(plural(words.units, p.units), { count: formatCount(p.units) }) }))
        setAsk({ title: fill(words.deleteTitle, { name: p.name }), target: p.name, consequence: words.deleteBody, confirmLabel: words.deleteConfirm, danger: true, onConfirm: () =>
            void run(async () => {
              await deletePlace(p.id)
              return fill(words.deleted, { name: p.name })
            }),
        })
      },
    })

  // The merchant side also reads its suppliers' locations: listed apart and never changed here (SetOps, FIRST-RELEASE §15).
  const own = (p: Place) => side === 'supplier' || p.supplierId === null
  const places = view.places.filter(own).sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
  const theirs = view.places.filter((p) => !own(p))
  return (
    <div className="df-places">
      <div className="df-places-head">
        <div>
          <h2>{words.title}</h2>
          <p className="df-places-hint">{words.sub}</p>
        </div>
        {canEdit && !form && (
          <button type="button" className="df-button" onClick={() => setForm(blank)}>
            {words.add}
          </button>
        )}
      </div>
      {!canEdit && <p className="df-places-hint">{words.viewOnly}</p>}
      {form && <PlaceForm key={form.id ?? 'new'} form={form} set={setForm} busy={busy} onSave={() => save(form)} onCancel={() => setForm(null)} />}
      {places.length === 0 ? (
        <p className="df-places-empty">{words.empty}</p>
      ) : (
        <ul className="df-places-list">
          {places.map((p) => (
            <li key={p.id}>
              <span className="df-places-mark" aria-hidden="true">
                {p.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="df-places-text">
                <strong>{p.name}</strong>
                <span>{[addressLine(p), fill(plural(words.units, p.units), { count: formatCount(p.units) })].filter(Boolean).join(' · ')}</span>
              </span>
              {p.isDefault && <span className="df-places-default">{words.default}</span>}
              {canEdit && (
                <button type="button" className="df-button" aria-label={fill(words.manage, { name: p.name })} disabled={busy} onClick={() => manage(p)}>
                  {words.manageButton}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {theirs.length > 0 && (
        <section className="df-places-theirs" aria-labelledby="df-places-theirs">
          <h2 id="df-places-theirs">{words.theirsTitle}</h2>
          <p className="df-places-hint">{words.theirsSub}</p>
          <ul className="df-places-list">
            {theirs.map((p) => (
              <li key={p.id}>
                <span className="df-places-mark df-places-mark--supplier" aria-hidden="true">
                  {words.supplierMark}
                </span>
                <span className="df-places-text">
                  <strong>{p.name}</strong>
                  <span>{[p.supplierName ?? '', addressLine(p), fill(plural(words.units, p.units), { count: formatCount(p.units) })].filter(Boolean).join(' · ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} {...ask} open cancelLabel={words.form.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
