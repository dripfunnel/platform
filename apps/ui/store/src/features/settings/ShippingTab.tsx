import { formatMoney, minorOf, moneyText } from '@dripfunnel/shared/format'
import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { Fragment, useId, useRef, useState, type ReactNode } from 'react'
import {
  connectCourier,
  disconnectCourier,
  loadShipping,
  replaceDeliveryArea,
  saveCourierOptions,
  saveShipping,
  testCouriers,
  useCourierForPricing,
  type Courier,
  type CourierTest,
  type ShippingInput,
  type ShippingSettings,
} from '../../api/shipping'
import { fill, formatCount, formatTime, locale, messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { maxPostalCodes, readPostalCodes } from './postalCodes'

const words = messages.settings.shipping
const refusalOf = refusalIn(words.refused)

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>
type Card = 'form' | 'couriers'

/** The longest collection hours the API keeps (apps/api/src/engine/modules/shipping/rules.ts). */
const pickupHoursMax = 120

/** What the form edits, amounts as typed in major units. */
interface Draft {
  courierRate: boolean
  flatRate: boolean
  flat: string
  pickup: boolean
  hours: string
  freeMode: ShippingSettings['freeMode']
  threshold: string
  areaMode: ShippingSettings['areaMode']
}
const draftKeys = ['courierRate', 'flatRate', 'flat', 'pickup', 'hours', 'freeMode', 'threshold', 'areaMode'] as const

const typed = (minor: string | null, currency: string) => (minor === null ? '' : moneyText({ amount: Number(minor), currency }))

const draftOf = (s: ShippingSettings): Draft => ({
  courierRate: s.courierRate,
  flatRate: s.flatRate,
  flat: typed(s.flatAmount, s.currency),
  pickup: s.pickup,
  hours: s.pickupHours ?? '',
  freeMode: s.freeMode,
  threshold: typed(s.freeThresholdAmount, s.currency),
  areaMode: s.areaMode,
})

/** A courier change or a list upload read back: what the merchant edited stays, the rest follows the server. */
const rebase = (draft: Draft, before: Draft, after: Draft): Draft => {
  const next = { ...after }
  for (const key of draftKeys) if (draft[key] !== before[key]) Object.assign(next, { [key]: draft[key] })
  return next
}

const same = (a: Draft, b: Draft) => draftKeys.every((key) => a[key] === b[key])

const nameOf = (provider: string) => (words.couriers as Record<string, string>)[provider] ?? provider
const labelSizeOf = (size: string) => (words.labelSizes as Record<string, string>)[size] ?? size

/** What a save sends, or which of the form's rules it breaks first. */
const inputOf = (d: Draft, s: ShippingSettings): ShippingInput | keyof typeof words.missing => {
  const flat = minorOf(d.flat, s.currency)
  const threshold = minorOf(d.threshold, s.currency)
  if (!d.courierRate && !d.flatRate && !d.pickup) return 'method'
  if (d.courierRate && !s.couriers.some((c) => c.status === 'pricing')) return 'courier'
  if (flat === 'invalid' || (d.freeMode === 'over' && threshold === 'invalid')) return 'amount'
  if (d.flatRate && flat === null) return 'flat'
  if (d.freeMode === 'over' && !threshold) return 'threshold'
  if (d.pickup && d.hours.trim() === '') return 'hours'
  if (d.areaMode === 'list' && s.areaCount === 0) return 'list'
  return {
    courierRate: d.courierRate,
    flatRate: d.flatRate,
    flatAmount: flat === null ? null : String(flat),
    pickup: d.pickup,
    pickupHours: d.hours.trim() || null,
    freeMode: d.freeMode,
    freeThresholdAmount: d.freeMode === 'over' && typeof threshold === 'number' ? String(threshold) : null,
    areaMode: d.areaMode,
  }
}

export interface ShippingTabProps {
  shipping: ShippingSettings
  country: string | null
  canEdit: boolean
  onSaved: (toast: string) => void
}

/** Shipping (SetOps "shipping"): what delivery costs, when it's free, the couriers on the partner's accounts, and where the store delivers. */
export const ShippingTab = ({ shipping, country, canEdit, onSaved }: ShippingTabProps) => {
  const id = useId()
  const file = useRef<HTMLInputElement>(null)
  const [server, setServer] = useState(shipping)
  const [draft, setDraft] = useState(() => draftOf(shipping))
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [tests, setTests] = useState<CourierTest[] | null>(null)
  const [failure, setFailure] = useState<{ card: Card; text: string } | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const latest = useRef(0)
  const base = useRef(shipping)
  const ro = !canEdit || busy || testing
  const saved = draftOf(server)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const postal = country === 'IN' || country === 'US' ? words.postal[country] : words.postal.other
  const pricing = server.couriers.find((c) => c.status === 'pricing')

  const adopt = (next: ShippingSettings) => {
    base.current = next
    setServer(next)
  }

  /** Read back after a courier change or an upload; only the newest read lands. */
  const refresh = async () => {
    const ask = ++latest.current
    const after = await loadShipping()
    if (ask !== latest.current) return
    const before = draftOf(base.current)
    adopt(after)
    setDraft((d) => rebase(d, before, draftOf(after)))
  }

  const run = async (card: Card, work: () => Promise<string | null>, readBack = true) => {
    setBusy(true)
    setFailure(null)
    try {
      const toast = await work()
      if (readBack) await refresh()
      if (toast) onSaved(toast)
    } catch (error) {
      setFailure({ card, text: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    const input = inputOf(draft, server)
    if (typeof input === 'string') return setFailure({ card: 'form', text: fill(words.missing[input], { label: postal, example: moneyText({ amount: 4900, currency: server.currency }) }) })
    void run(
      'form',
      async () => {
        const revision = await saveShipping(base.current.revision, input)
        const next = { ...base.current, revision, courierRate: input.courierRate, flatRate: input.flatRate, flatAmount: input.flatAmount, pickup: input.pickup, pickupHours: input.pickupHours, freeMode: input.freeMode, freeThresholdAmount: input.freeThresholdAmount, areaMode: input.areaMode }
        adopt(next)
        setDraft(draftOf(next))
        return words.saved
      },
      false,
    )
  }

  const upload = async (picked: File) => {
    setFailure(null)
    const read = readPostalCodes(picked.name, await picked.text(), country)
    if (read.kind !== 'codes') return setFailure({ card: 'form', text: fill(read.kind === 'notText' ? words.notText : read.kind === 'tooMany' ? words.tooMany : words.noCodes, { file: picked.name, label: postal, max: formatCount(maxPostalCodes) }) })
    void run('form', async () => {
      const kept = await replaceDeliveryArea(picked.name, read.codes)
      return fill(draft.areaMode === 'list' && saved.areaMode === 'list' ? words.areaRead : words.areaReadSave, { count: formatCount(kept), label: postal, file: picked.name })
    })
  }

  const runTests = async () => {
    setTesting(true)
    setFailure(null)
    setTests(null)
    try {
      setTests(await testCouriers())
      await refresh()
    } catch (error) {
      setFailure({ card: 'couriers', text: refusalOf(error) })
    } finally {
      setTesting(false)
    }
  }

  const askHours = () =>
    setAsk({
      title: words.hoursTitle,
      target: '',
      consequence: words.hoursBody,
      confirmLabel: words.saveHours,
      input: { label: words.hoursLabel, type: 'text', initial: draft.hours, placeholder: words.hoursPlaceholder, error: (v) => (v.trim() === '' ? words.hoursMissing : v.trim().length > pickupHoursMax ? fill(words.hoursTooLong, { max: String(pickupHoursMax) }) : null) },
      onConfirm: (_, value) => set({ hours: (value ?? '').trim() }),
    })

  const askManage = (c: Courier) =>
    setAsk({
      title: nameOf(c.provider),
      target: '',
      consequence: fill(words.manageBody, { name: nameOf(c.provider) }),
      confirmLabel: words.save,
      choices: [
        { key: 'pickup', label: words.pickupsLabel, options: (['scheduled', 'on_request'] as const).map((v) => ({ value: v, label: words.pickupChoices[v] })), initial: c.pickupMode, error: () => null },
        { key: 'label', label: words.labelLabel, options: server.labelSizes.map((v) => ({ value: v, label: labelSizeOf(v) })), initial: c.labelSize, error: () => null },
        { key: 'tracking', label: words.trackingLabel, options: (['on', 'off'] as const).map((v) => ({ value: v, label: words.trackingChoices[v] })), initial: c.trackingEmails ? 'on' : 'off', error: () => null },
      ],
      onConfirm: (_, __, picks) =>
        void run('couriers', async () => {
          await saveCourierOptions(c.provider, { pickupMode: picks['pickup'] === 'on_request' ? 'on_request' : 'scheduled', labelSize: picks['label'] ?? c.labelSize, trackingEmails: picks['tracking'] !== 'off' })
          return fill(words.optionsSaved, { name: nameOf(c.provider) })
        }),
    })

  const askDisconnect = (c: Courier) => {
    const others = server.couriers.filter((x) => x.provider !== c.provider && x.status !== 'off')
    const next = c.status === 'pricing' ? others.find((x) => x.status === 'standby') : undefined
    setAsk({
      title: fill(words.disconnectName, { name: nameOf(c.provider) }) + '?',
      target: nameOf(c.provider),
      consequence: others.length === 0 ? words.disconnectLast : next ? fill(words.disconnectTakesOver, { next: nameOf(next.provider) }) : words.disconnectStandby,
      confirmLabel: words.disconnect,
      danger: true,
      onConfirm: () =>
        void run('couriers', async () => {
          setTests(null)
          const now = await disconnectCourier(c.provider)
          return now ? fill(words.disconnectedNext, { name: nameOf(c.provider), next: nameOf(now) }) : fill(words.disconnected, { name: nameOf(c.provider) })
        }),
    })
  }

  const connect = (c: Courier) =>
    void run('couriers', async () => {
      setTests(null)
      const status = await connectCourier(c.provider)
      return fill(status === 'pricing' ? words.connectedPricing : words.connectedStandby, { name: nameOf(c.provider) })
    })

  const usePricing = (c: Courier) =>
    void run('couriers', async () => {
      await useCourierForPricing(c.provider)
      return fill(words.nowPricing, { name: nameOf(c.provider) })
    })

  const failureOn = (card: Card) =>
    failure?.card === card && (
      <p className="df-set-failure" role="alert">
        {failure.text}
      </p>
    )

  const choice = (props: { type: 'checkbox' | 'radio'; name?: string; checked: boolean; onChange: () => void; label: string; sub: string; extra?: ReactNode }) => (
    <div className={props.checked ? 'df-ops-row df-ops-choice df-ops-choice--on' : 'df-ops-row df-ops-choice'}>
      <label className="df-ops-pick">
        <input type={props.type} name={props.name} checked={props.checked} disabled={!canEdit || busy} onChange={props.onChange} />
        <span className="df-ops-text">
          <strong>{props.label}</strong>
          {props.sub && <span>{props.sub}</span>}
        </span>
      </label>
      {props.extra}
    </div>
  )

  const amount = (label: string, value: string, onValue: (v: string) => void) => (
    <span className="df-ops-amount">
      <span aria-hidden="true">{server.currency}</span>
      <input aria-label={label} inputMode="decimal" value={value} disabled={!canEdit || busy} onChange={(e) => onValue(e.target.value)} />
    </span>
  )

  const button = (label: string, aria: string, onClick: () => void) => (
    <button key={label} type="button" className="df-button df-button--small" disabled={ro} aria-label={aria} onClick={onClick}>
      {label}
    </button>
  )

  const courierDesc = (c: Courier) => {
    if (c.status === 'off') return c.offered ? '' : words.descNotOffered
    if (c.status === 'failed') return words.descFailed
    if (c.status === 'standby') return words.descStandby
    return fill(words.descPricing, { pickup: words.pickupModes[c.pickupMode], label: labelSizeOf(c.labelSize) })
  }

  const courierActions = (c: Courier) => {
    if (!canEdit) return null
    const name = nameOf(c.provider)
    if (c.status === 'off') return c.offered ? button(words.connect, fill(words.connectName, { name }), () => connect(c)) : null
    return [
      ...(c.status === 'standby' ? [button(words.usePricing, fill(words.usePricingName, { name }), () => usePricing(c))] : []),
      button(words.manage, fill(words.manageName, { name }), () => askManage(c)),
      button(words.disconnect, fill(words.disconnectName, { name }), () => askDisconnect(c)),
    ]
  }

  const threshold = minorOf(draft.threshold, server.currency)
  const connectedCount = server.couriers.filter((c) => c.status !== 'off').length
  const failed = tests ? tests.filter((t) => t.result !== 'ok').length : 0

  return (
    <div className="df-set-store">
      <section className="df-set-card" aria-labelledby={`${id}-charge`}>
        <h2 id={`${id}-charge`}>{words.chargeTitle}</h2>
        <p className="df-set-lede">{words.chargeSub}</p>
        <div role="group" aria-labelledby={`${id}-charge`} className="df-ops-rows">
          {choice({ type: 'checkbox', checked: draft.courierRate, onChange: () => set({ courierRate: !draft.courierRate }), label: words.courierRate, sub: pricing ? fill(words.courierRateBy, { name: nameOf(pricing.provider) }) : words.courierRateNone })}
          {choice({
            type: 'checkbox',
            checked: draft.flatRate,
            onChange: () => set({ flatRate: !draft.flatRate }),
            label: words.flatRate,
            sub: draft.flatRate || !draft.courierRate ? words.flatRateSub : words.flatFallback,
            extra: (draft.flatRate || draft.courierRate) && amount(words.flatLabel, draft.flat, (flat) => set({ flat })),
          })}
          {choice({
            type: 'checkbox',
            checked: draft.pickup,
            onChange: () => set({ pickup: !draft.pickup }),
            label: words.pickup,
            sub: draft.pickup ? fill(words.pickupOn, { address: server.pickupAddress ?? words.pickupNoAddress, hours: draft.hours || words.noHours }) : words.pickupOff,
            extra: draft.pickup && canEdit && button(draft.hours ? words.changeHours : words.setHours, draft.hours ? words.changeHours : words.setHours, askHours),
          })}
        </div>
      </section>

      <section className="df-set-card" aria-labelledby={`${id}-free`}>
        <h2 id={`${id}-free`}>{words.freeTitle}</h2>
        <div role="radiogroup" aria-labelledby={`${id}-free`} className="df-ops-rows">
          {(['never', 'always', 'over'] as const).map((mode) => (
            <Fragment key={mode}>
              {choice({
                type: 'radio',
                name: `${id}-free-mode`,
                checked: draft.freeMode === mode,
                onChange: () => set({ freeMode: mode }),
                label: words.free[mode],
                sub: mode === 'over' && draft.freeMode === 'over' && typeof threshold === 'number' && threshold > 0 ? fill(words.freeOver, { amount: formatMoney({ amount: threshold, currency: server.currency }, locale) }) : '',
                extra: mode === 'over' && draft.freeMode === 'over' && amount(words.thresholdLabel, draft.threshold, (t) => set({ threshold: t })),
              })}
            </Fragment>
          ))}
        </div>
      </section>

      <section className="df-set-card" aria-labelledby={`${id}-partners`}>
        <div className="df-set-foot">
          <span className="df-ops-head">
            <h2 id={`${id}-partners`}>{words.partnersTitle}</h2>
            <span className="df-set-help">{words.partnersSub}</span>
          </span>
          {canEdit && connectedCount > 0 && (
            <button type="button" className="df-button df-button--small" disabled={ro} onClick={() => void runTests()}>
              {testing ? words.testing : words.testAll}
            </button>
          )}
        </div>
        {failureOn('couriers')}
        {tests && (
          <div className="df-set-note" role="status">
            <strong>{tests.length === 0 ? words.testNone : failed ? fill(words.testSome, { bad: formatCount(failed), count: formatCount(tests.length) }) : fill(words.testAllOk, { count: formatCount(tests.length) })}</strong>
            <ul className="df-ops-tests">
              {tests.map((t) => (
                <li key={t.provider}>{fill(words.testResults[t.result], { name: nameOf(t.provider), seconds: new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(t.ms / 1000) })}</li>
              ))}
            </ul>
          </div>
        )}
        {server.couriers.length === 0 ? (
          <span className="df-set-help">{words.partnersNone}</span>
        ) : (
          <ul className="df-ops-rows">
            {server.couriers.map((c) => (
              <li key={c.provider} className="df-ops-row">
                <span className="df-ops-mark" aria-hidden="true">
                  {nameOf(c.provider).slice(0, 2).toUpperCase()}
                </span>
                <span className="df-ops-text">
                  <strong>{nameOf(c.provider)}</strong>
                  {courierDesc(c) && <span>{courierDesc(c)}</span>}
                  {c.status !== 'off' && c.lastTestedAt && <span>{fill(words.lastTested, { time: formatTime(c.lastTestedAt) })}</span>}
                </span>
                <span className={`df-ops-status df-ops-status--${c.status === 'pricing' ? 'ok' : c.status === 'failed' ? 'warn' : 'off'}`}>{words.status[c.status]}</span>
                {courierActions(c)}
              </li>
            ))}
          </ul>
        )}
        <span className="df-set-help">{words.partnersNote}</span>
      </section>

      <section className="df-set-card" aria-labelledby={`${id}-area`}>
        <h2 id={`${id}-area`}>{words.areaTitle}</h2>
        <div role="radiogroup" aria-labelledby={`${id}-area`} className="df-ops-rows">
          {choice({ type: 'radio', name: `${id}-area-mode`, checked: draft.areaMode === 'everywhere', onChange: () => set({ areaMode: 'everywhere' }), label: words.everywhere, sub: words.everywhereSub })}
          {choice({
            type: 'radio',
            name: `${id}-area-mode`,
            checked: draft.areaMode === 'list',
            onChange: () => set({ areaMode: 'list' }),
            label: fill(words.list, { label: postal }),
            sub: draft.areaMode !== 'list' ? words.listSub : server.areaCount > 0 ? fill(words.listFile, { file: server.areaFileName ?? '', count: formatCount(server.areaCount), sample: server.areaSample.join(', ') }) : words.listNone,
            extra: draft.areaMode === 'list' && canEdit && button(server.areaCount > 0 ? words.replace : words.upload, fill(words.uploadName, { label: postal }), () => file.current?.click()),
          })}
        </div>
        <input
          ref={file}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          hidden
          onChange={(e) => {
            const picked = e.target.files?.[0]
            e.target.value = ''
            if (picked) void upload(picked)
          }}
        />
        {failureOn('form')}
        {canEdit && (
          <div className="df-set-foot">
            <span />
            <button type="button" className="df-button df-button--primary" disabled={ro || same(draft, saved)} onClick={save}>
              {words.saveShipping}
            </button>
          </div>
        )}
      </section>
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}|${ask.confirmLabel}`} {...ask} open cancelLabel={messages.settings.payments.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
