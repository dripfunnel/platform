import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useId, useState } from 'react'
import { addTaxCategory, deleteTaxClass, setHomeTaxRate, saveInvoiceSettings, saveTaxClass, setPricesIncludeTax, type InvoiceSettings, type TaxClass, type TaxSetupFull, type TaxZone } from '../../api/tax'
import { fill, formatCount, locale, messages, plural } from '../../messages'
import { RadioCards } from '../common/RadioCards'
import { refusalIn } from '../common/refusal'

const words = messages.settings.tax

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

const refusalOf = refusalIn(words.refused)

/** What the home country calls its tax, and whether its stores usually type prices with it included. */
export const taxWordsFor = (country: string | null): { name: string; usuallyIncluded: boolean } =>
  country === 'IN' ? { name: words.names.gst, usuallyIncluded: true } : country === 'US' || country === 'CA' ? { name: words.names.salesTax, usuallyIncluded: false } : { name: words.names.vat, usuallyIncluded: true }

/** The zone for the home country as a whole (no regions): the rate a category has at home. */
export const homeZone = (zones: readonly TaxZone[], country: string | null): TaxZone | null => zones.find((z) => country !== null && z.countries.includes(country) && z.regions.length === 0) ?? null

const percent = (bps: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bps / 100)}%`

/** "Books 7" or "Books 7.5%": a category's name and its rate at home, in basis points. */
export const parseRate = (text: string): { name: string; bps: number } | null => {
  const m = /^(.*?)\s*(\d+(?:\.\d{1,2})?)\s*%?$/.exec(text.trim())
  if (!m || !m[1] || !m[2]) return null
  const bps = Math.round(Number(m[2]) * 100)
  return m[1].trim() && bps <= 10_000 ? { name: m[1].trim(), bps } : null
}

export interface TaxTabProps {
  tax: TaxSetupFull
  invoice: InvoiceSettings
  country: string | null
  taxId: string | null
  canEdit: boolean
  /** Said, nothing to read again (the price mode, the invoice). */
  onSaved: (toast: string) => void
  /** A category or rate changed: the tab reads the setup again. */
  onChanged: (toast: string) => void
}

/** Tax setup: how prices are typed, the store's categories and their rates at home, other places' rates, and the invoice. */
export const TaxTab = ({ tax, invoice, country, taxId, canEdit, onSaved, onChanged }: TaxTabProps) => {
  const id = useId()
  const [included, setIncluded] = useState(tax.pricesIncludeTax)
  const [savedIncluded, setSavedIncluded] = useState(tax.pricesIncludeTax)
  const [perLine, setPerLine] = useState(invoice.taxPerLine)
  const [email, setEmail] = useState(invoice.emailWithDispatch)
  const [savedInvoice, setSavedInvoice] = useState({ perLine: invoice.taxPerLine, email: invoice.emailWithDispatch })
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ card: 'prices' | 'invoice'; text: string } | null>(null)
  const t = taxWordsFor(country)
  const home = homeZone(tax.zones, country)
  const others = tax.zones.filter((z) => z !== home)
  const rateOf = (c: TaxClass) => home?.rates.find((r) => r.taxClassId === c.id)?.rateBps ?? null
  const ro = !canEdit || busy

  const write = async (card: 'prices' | 'classes' | 'invoice', work: () => Promise<string>, after: () => void = () => undefined) => {
    setBusy(true)
    setFailure(null)
    try {
      const toast = await work()
      after()
      if (card === 'classes') onChanged(toast)
      else onSaved(toast)
    } catch (error) {
      // A category change may have half happened: the tab reads the setup again, the refusal said in the toast.
      if (card === 'classes') onChanged(refusalOf(error))
      else setFailure({ card, text: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const savePrices = () =>
    setAsk({
      title: fill(included ? words.includeTitle : words.excludeTitle, { name: t.name }),
      target: '',
      consequence: fill(words.keepNumbers, { name: t.name }),
      confirmLabel: words.save,
      onConfirm: () => void write('prices', async () => (await setPricesIncludeTax(included), fill(included ? words.nowIncluded : words.nowExcluded, { name: t.name })), () => setSavedIncluded(included)),
    })

  const homeName = country ? (new Intl.DisplayNames([locale], { type: 'region' }).of(country) ?? country) : ''
  // One call: the server finds the home zone, or makes it, under its lock, so two people can't both make one.
  const setHomeRate = (classId: string, bps: number) => setHomeTaxRate(classId, bps, homeName)
  const usesRates = country !== 'US' && country !== null

  const addCategory = () =>
    setAsk({
      title: words.addTitle,
      target: '',
      consequence: words.addBody,
      confirmLabel: words.add,
      input: { label: words.addLabel, type: 'text', initial: '', placeholder: words.addPlaceholder, error: (v) => (parseRate(v) ? null : words.addInvalid) },
      onConfirm: (_, value) => {
        const parsed = parseRate(value ?? '')
        // The category and its rate are one server transaction: a refusal or a lost connection leaves no rate-less category.
        if (parsed) void write('classes', async () => (await addTaxCategory(parsed.name, parsed.bps, homeName), fill(words.added, { name: parsed.name })))
      },
    })

  const optionsFor = (c: TaxClass) => [...(c.isDefault ? [] : [{ value: 'default', label: words.makeDefault }]), ...(usesRates ? [{ value: 'rate', label: words.changeRate }] : []), ...(c.isDefault || c.versions > 0 ? [] : [{ value: 'delete', label: words.delete }])]

  const manage = (c: TaxClass) =>
    setAsk({
      title: c.name,
      target: fill(plural(words.versions, c.versions), { count: formatCount(c.versions) }),
      consequence: '',
      confirmLabel: words.continue,
      choices: [
        {
          key: 'what',
          label: words.whatNow,
          options: optionsFor(c),
          initial: optionsFor(c)[0]?.value ?? '',
          error: () => null,
        },
      ],
      onConfirm: (_, __, picks) => {
        if (picks['what'] === 'default') return void write('classes', async () => (await saveTaxClass(c.id, { name: c.name, taxCode: c.taxCode, isDefault: true }), fill(words.nowDefault, { name: c.name })))
        if (picks['what'] === 'delete')
          return setAsk({ title: fill(words.deleteTitle, { name: c.name }), target: c.name, consequence: words.deleteBody, confirmLabel: words.delete, danger: true, onConfirm: () => void write('classes', async () => (await deleteTaxClass(c.id), fill(words.deleted, { name: c.name }))) })
        const now = rateOf(c)
        setAsk({
          title: fill(words.rateTitle, { name: c.name, place: homeName }),
          target: c.name,
          consequence: words.rateBody,
          confirmLabel: words.save,
          input: { label: words.rateLabel, type: 'text', initial: now === null ? '' : String(now / 100), placeholder: words.ratePlaceholder, error: (v) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) <= 100 ? null : words.rateInvalid) },
          onConfirm: (_, value) => void write('classes', async () => (await setHomeRate(c.id, Math.round(Number(value) * 100)), fill(words.rateSaved, { name: c.name }))),
        })
      },
    })

  const classWord = usesRates ? words.categoriesRates : words.categories
  return (
    <div className="df-set-store">
      <section className="df-set-card" aria-labelledby={`${id}-prices`}>
        <h2 id={`${id}-prices`}>{words.pricesTitle}</h2>
        <p className="df-set-lede">{fill(t.usuallyIncluded ? words.pricesUsualIn : words.pricesUsualOut, { name: t.name })}</p>
        {failure?.card === 'prices' && (
          <p className="df-set-failure" role="alert">
            {failure.text}
          </p>
        )}
        <RadioCards
          labelledBy={`${id}-prices`}
          value={included ? 'included' : 'excluded'}
          disabled={ro}
          onChange={(v) => setIncluded(v === 'included')}
          options={(['included', 'excluded'] as const).map((v) => ({
            value: v,
            label: fill(v === 'included' ? words.include : words.exclude, { name: t.name }),
            sub: fill(v === 'included' ? words.includeSub : words.excludeSub, { name: t.name }),
            // In words: the UI never works out a price or its tax (ui/README §3).
            extra: <span className="df-tax-example">{fill(v === 'included' ? words.exampleIncluded : words.exampleExcluded, { name: t.name })}</span>,
          }))}
        />
        {canEdit && (
          <div className="df-set-foot">
            <span />
            <button type="button" className="df-button df-button--primary" disabled={busy || included === savedIncluded} onClick={savePrices}>
              {words.save}
            </button>
          </div>
        )}
      </section>

      <section className="df-set-card" aria-labelledby={`${id}-classes`}>
        <div className="df-set-foot">
          <h2 id={`${id}-classes`}>{fill(words.yours, { what: classWord })}</h2>
          {canEdit && usesRates && (
            <button type="button" className="df-button df-button--small" disabled={busy} onClick={addCategory}>
              {words.addTitle}
            </button>
          )}
        </div>
        <p className="df-set-lede">{usesRates ? words.classesSub : words.classesSubUs}</p>
        <ul className="df-tax-classes">
          {tax.classes.map((c) => {
            const rate = rateOf(c)
            return (
              <li key={c.id}>
                <span>
                  <strong>{c.name}</strong>
                  <span>{fill(plural(words.versions, c.versions), { count: formatCount(c.versions) })}</span>
                </span>
                <span className={c.isDefault ? 'df-tax-rate df-tax-rate--default' : 'df-tax-rate'}>
                  {[usesRates ? (rate === null ? words.noRate : percent(rate)) : words.byState, c.isDefault ? words.default : ''].filter(Boolean).join(' · ')}
                </span>
                {canEdit && optionsFor(c).length > 0 && (
                  <button type="button" className="df-button df-button--small" disabled={busy} aria-label={fill(words.manage, { name: c.name })} onClick={() => manage(c)}>
                    {words.manageButton}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="df-set-help">{words.defaultNote}</p>
      </section>

      {others.length > 0 && (
        <section className="df-set-card" aria-labelledby={`${id}-zones`}>
          <h2 id={`${id}-zones`}>{words.otherPlaces}</h2>
          <ul className="df-tax-classes">
            {others.map((z) => (
              <li key={z.id}>
                <span>
                  <strong>{z.name}</strong>
                  <span>{[...z.countries, ...z.regions].join(', ')}</span>
                </span>
                <span className="df-tax-rate">
                  {z.rates
                    .map((r) => `${tax.classes.find((c) => c.id === r.taxClassId)?.name ?? ''} ${percent(r.rateBps)}`)
                    .filter((x) => x.trim())
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="df-set-card" aria-labelledby={`${id}-invoice`}>
        <h2 id={`${id}-invoice`}>{words.invoiceTitle}</h2>
        <p className="df-set-lede">{taxId ? fill(words.invoiceTaxId, { id: taxId }) : words.invoiceNoTaxId}</p>
        {failure?.card === 'invoice' && (
          <p className="df-set-failure" role="alert">
            {failure.text}
          </p>
        )}
        <label className="df-tax-check">
          <input type="checkbox" checked={perLine} disabled={ro} onChange={(e) => setPerLine(e.target.checked)} />
          {fill(words.perLine, { name: t.name })}
        </label>
        <label className="df-tax-check">
          <input type="checkbox" checked={email} disabled={ro} onChange={(e) => setEmail(e.target.checked)} />
          {words.emailInvoice}
        </label>
        <div className="df-set-foot">
          <span className="df-set-help">{words.invoiceNote}</span>
          {canEdit && (
            <button
              type="button"
              className="df-button df-button--primary"
              disabled={busy || (perLine === savedInvoice.perLine && email === savedInvoice.email)}
              onClick={() => void write('invoice', async () => (await saveInvoiceSettings({ taxPerLine: perLine, emailWithDispatch: email, footer: invoice.footer }), words.invoiceSaved), () => setSavedInvoice({ perLine, email }))}
            >
              {words.saveInvoice}
            </button>
          )}
        </div>
      </section>
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}|${ask.confirmLabel}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
