import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadStoreInfo } from '../../../api/settingsStore'
import {
  addTaxCategory,
  deleteTaxClass,
  loadInvoiceSettings,
  loadTax,
  makeDefaultClass,
  saveInvoiceSettings,
  setHomeTaxRate,
  setPricesIncludeTax,
  type InvoiceSettings,
  type TaxClass,
  type TaxSetup,
} from '../../../api/settingsTax'
import type { ApiClient } from '../../../graphql'
import { formatList, regionName } from '../../../format'
import { locale, t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { ChoiceRows } from '../ChoiceRows'
import { FormSheet } from '../FormSheet'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { useWrite } from '../useWrite'
import { bpsOf } from '../percent'
import { actionsFor, homeZone, percent, rateOf, ratesAtHome, taxWordsFor } from './taxView'

// Settings › Tax setup (CatSettings tax tab and SetOps tax; FIRST-RELEASE (store) §15): how prices are typed, the categories with their rates at home,
// the rates in other places (listed only), and the invoice. The rates are the API's; the app never works out a price or its tax.
export function TaxTab() {
  return (
    <TabFrame
      label={t('settings.tabs.tax')}
      load={async (client) => {
        const [tax, invoice, info] = await Promise.all([loadTax(client), loadInvoiceSettings(client), loadStoreInfo(client).catch(() => null)])
        if (!tax || !invoice) throw new Error('tax setup missing')
        return { tax, invoice, country: info?.country ?? null, taxId: info?.taxId ?? null }
      }}
    >
      {({ data, client, canEdit, refresh }) => <TaxBody tax={data.tax} invoice={data.invoice} country={data.country} taxId={data.taxId} client={client} canEdit={canEdit} refresh={refresh} />}
    </TabFrame>
  )
}

type Props = { tax: TaxSetup; invoice: InvoiceSettings; country: string | null; taxId: string | null; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }
type Sheet = { kind: 'prices' } | { kind: 'add' } | { kind: 'default'; taxClass: TaxClass } | { kind: 'rate'; taxClass: TaxClass } | { kind: 'delete'; taxClass: TaxClass }

function TaxBody({ tax, invoice, country, taxId, client, canEdit, refresh }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const words = taxWordsFor(country)
  const name = t(`settings.tax.names.${words.name}`)
  const home = homeZone(tax.zones, country)
  const others = tax.zones.filter((zone) => zone !== home)
  const atHome = ratesAtHome(country)
  const homeName = country ? regionName(country, locale) : ''
  const [included, setIncluded] = useState(tax.pricesIncludeTax)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const close = () => setSheet(null)

  const openMenu = (taxClass: TaxClass) => {
    const actions = actionsFor(taxClass, country)
    if (actions.length === 0) return
    feedback.menu({
      title: taxClass.name,
      sub: tCount('settings.tax.versions', taxClass.versions),
      items: actions.map((action) =>
        action === 'default'
          ? { key: action, label: t('settings.tax.makeDefault'), onPress: () => setSheet({ kind: 'default', taxClass }) }
          : action === 'rate'
            ? { key: action, label: t('settings.tax.changeRate'), onPress: () => setSheet({ kind: 'rate', taxClass }) }
            : { key: action, label: t('settings.tax.delete'), danger: true, onPress: () => setSheet({ kind: 'delete', taxClass }) },
      ),
    })
  }

  return (
    <>
      <SectionCard title={t('settings.tax.pricesTitle')} sub={t(words.usuallyIncluded ? 'settings.tax.pricesUsualIn' : 'settings.tax.pricesUsualOut', { name })}>
        <ChoiceRows
          value={included ? 'included' : 'excluded'}
          disabled={!canEdit}
          onChange={(value) => setIncluded(value === 'included')}
          options={[
            { value: 'included', label: t('settings.tax.include', { name }), sub: `${t('settings.tax.includeSub', { name })} ${t('settings.tax.exampleIncluded', { name })}` },
            { value: 'excluded', label: t('settings.tax.exclude', { name }), sub: `${t('settings.tax.excludeSub', { name })} ${t('settings.tax.exampleExcluded', { name })}` },
          ]}
        />
        {canEdit ? <Button saves disabled={included === tax.pricesIncludeTax} label={t('settings.common.save')} onPress={() => setSheet({ kind: 'prices' })} /> : null}
      </SectionCard>

      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.tax.yours', { what: t(atHome ? 'settings.tax.categoriesRates' : 'settings.tax.categories') })}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{atHome ? t('settings.tax.classesSub') : t('settings.tax.classesSubUs')}</Text>
        {canEdit && atHome ? <Button saves kind="secondary" label={t('settings.tax.addTitle')} onPress={() => setSheet({ kind: 'add' })} /> : null}
      </View>
      {tax.classes.map((taxClass) => {
        const rate = rateOf(home, taxClass)
        return (
          <RowCard
            key={taxClass.id}
            title={taxClass.name}
            sub={tCount('settings.tax.versions', taxClass.versions)}
            value={atHome ? (rate === null ? t('settings.tax.noRate') : percent(rate)) : t('settings.tax.byState')}
            status={taxClass.isDefault ? t('settings.tax.default') : undefined}
            tone="ok"
            onPress={canEdit && actionsFor(taxClass, country).length > 0 ? () => openMenu(taxClass) : null}
            accessibilityLabel={t('settings.tax.manage', { name: taxClass.name })}
          />
        )
      })}
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.tax.defaultNote')}</Text>

      {others.length > 0 ? (
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('settings.tax.otherPlaces')}
          </Text>
          {others.map((zone) => (
            <RowCard
              key={zone.id}
              title={zone.name}
              sub={formatList([...zone.countries, ...zone.regions], locale)}
              value={zone.rates
                .map((rate) => `${tax.classes.find((taxClass) => taxClass.id === rate.taxClassId)?.name ?? ''} ${percent(rate.rateBps)}`.trim())
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </View>
      ) : null}

      <InvoiceCard invoice={invoice} taxId={taxId} name={name} client={client} canEdit={canEdit} />

      {sheet?.kind === 'prices' ? (
        <FormSheet
          title={t(included ? 'settings.tax.includeTitle' : 'settings.tax.excludeTitle', { name })}
          body={t('settings.tax.keepNumbers', { name })}
          confirm={t('settings.common.save')}
          context="settingsTax"
          onClose={close}
          onSubmit={async () => {
            await setPricesIncludeTax(client, included)
            await refresh()
            return t(included ? 'settings.tax.nowIncluded' : 'settings.tax.nowExcluded', { name })
          }}
        />
      ) : null}
      {sheet?.kind === 'add' ? <AddSheet homeName={homeName} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'rate' ? <RateSheet taxClass={sheet.taxClass} current={rateOf(home, sheet.taxClass)} homeName={homeName} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'default' ? (
        <FormSheet
          title={t('settings.tax.makeDefaultTitle', { name: sheet.taxClass.name })}
          body={t('settings.tax.makeDefaultBody')}
          confirm={t('settings.tax.makeDefault')}
          context="settingsTax"
          onClose={close}
          onSubmit={async () => {
            await makeDefaultClass(client, sheet.taxClass)
            await refresh()
            return t('settings.tax.nowDefault', { name: sheet.taxClass.name })
          }}
        />
      ) : null}
      {sheet?.kind === 'delete' ? (
        <FormSheet
          title={t('settings.tax.deleteTitle', { name: sheet.taxClass.name })}
          body={t('settings.tax.deleteBody')}
          confirm={t('settings.tax.delete')}
          danger
          context="settingsTax"
          onClose={close}
          onSubmit={async () => {
            await deleteTaxClass(client, sheet.taxClass.id)
            await refresh()
            return t('settings.tax.deleted', { name: sheet.taxClass.name })
          }}
        />
      ) : null}
    </>
  )
}

type DoneProps = { homeName: string; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

function AddSheet({ homeName, client, onClose, onDone }: DoneProps) {
  const [label, setLabel] = useState('')
  const [rate, setRate] = useState('')
  const [tried, setTried] = useState(false)
  const bps = bpsOf(rate)
  return (
    <FormSheet
      title={t('settings.tax.addTitle')}
      body={t('settings.tax.addBody')}
      confirm={t('settings.tax.add')}
      context="settingsTax"
      onClose={onClose}
      check={() => {
        setTried(true)
        return label.trim() === '' ? t('settings.tax.addNameMissing') : bps === null ? t('settings.tax.rateInvalid') : null
      }}
      onSubmit={async () => {
        // The category and its rate are one server transaction, so a refusal or a lost connection leaves no category without a rate.
        await addTaxCategory(client, label.trim(), bps ?? 0, homeName)
        await onDone()
        return t('settings.tax.added', { name: label.trim() })
      }}
    >
      <TextField label={t('settings.tax.addName')} value={label} onChangeText={setLabel} placeholder={t('settings.tax.addNamePlaceholder')} autoCapitalize="words" invalid={tried && label.trim() === ''} />
      <TextField label={t('settings.tax.rateLabel')} value={rate} onChangeText={setRate} placeholder={t('settings.tax.ratePlaceholder')} keyboardType="decimal-pad" invalid={tried && bps === null} />
    </FormSheet>
  )
}

function RateSheet({ taxClass, current, homeName, client, onClose, onDone }: DoneProps & { taxClass: TaxClass; current: number | null }) {
  const [rate, setRate] = useState(current === null ? '' : String(current / 100))
  const [tried, setTried] = useState(false)
  const bps = bpsOf(rate)
  return (
    <FormSheet
      title={t('settings.tax.rateTitle', { name: taxClass.name, place: homeName })}
      body={t('settings.tax.rateBody')}
      confirm={t('settings.common.save')}
      context="settingsTax"
      onClose={onClose}
      check={() => {
        setTried(true)
        return bps === null ? t('settings.tax.rateInvalid') : null
      }}
      onSubmit={async () => {
        await setHomeTaxRate(client, taxClass.id, bps ?? 0, homeName)
        await onDone()
        return t('settings.tax.rateSaved', { name: taxClass.name })
      }}
    >
      <TextField label={t('settings.tax.rateLabel')} value={rate} onChangeText={setRate} placeholder={t('settings.tax.ratePlaceholder')} keyboardType="decimal-pad" invalid={tried && bps === null} />
    </FormSheet>
  )
}

function InvoiceCard({ invoice, taxId, name, client, canEdit }: { invoice: InvoiceSettings; taxId: string | null; name: string; client: ApiClient; canEdit: boolean }) {
  const { colors } = useTheme()
  const write = useWrite('settingsTax')
  const [saved, setSaved] = useState({ perLine: invoice.taxPerLine, email: invoice.emailWithDispatch })
  const [perLine, setPerLine] = useState(saved.perLine)
  const [email, setEmail] = useState(saved.email)
  const dirty = perLine !== saved.perLine || email !== saved.email

  const save = async () => {
    // The footer goes back as it is: the phone changes the two switches only.
    if (await write.run(async () => (await saveInvoiceSettings(client, { taxPerLine: perLine, emailWithDispatch: email, footer: invoice.footer }), t('settings.tax.invoiceSaved')))) setSaved({ perLine, email })
  }

  return (
    <SectionCard title={t('settings.tax.invoiceTitle')} sub={taxId ? t('settings.tax.invoiceTaxId', { id: taxId }) : t('settings.tax.invoiceNoTaxId')}>
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      <Switch label={t('settings.tax.perLine', { name })} value={perLine} onChange={setPerLine} disabled={!canEdit} />
      <Switch label={t('settings.tax.emailInvoice')} value={email} onChange={setEmail} disabled={!canEdit} />
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.tax.invoiceNote')}</Text>
      {canEdit ? <Button saves busy={write.busy} disabled={!dirty} label={t('settings.tax.saveInvoice')} onPress={() => void save()} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
