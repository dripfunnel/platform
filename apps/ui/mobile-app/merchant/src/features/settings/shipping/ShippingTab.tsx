import { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadStoreInfo } from '../../../api/settingsStore'
import { loadShipping, replaceDeliveryArea, saveShipping, type ShippingSettings } from '../../../api/settingsShipping'
import { formatMoney, formatNumber, minorOf, moneyText } from '../../../format'
import { isApiError, type ApiClient } from '../../../graphql'
import { locale, t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { TextArea } from '../../common/TextArea'
import { ChoiceRows } from '../ChoiceRows'
import { FormSheet } from '../FormSheet'
import { TabFrame } from '../TabFrame'
import { useWrite } from '../useWrite'
import { nameOf } from './courierNames'
import { CouriersCard } from './CouriersCard'
import { maxPostalCodes, readPostalCodes } from './postalCodes'
import { draftOf, inputOf, pickupHoursMax, rebase, same, type Draft } from './shippingDraft'

// Settings › Shipping (SetOps "shipping"; FIRST-RELEASE (store) §15): what the shopper pays, when delivery is free, the couriers and where the store delivers,
// as one draft saved over its revision. The codes of a delivery list are typed or pasted (decided on #504: no file picker), and each amount is typed in
// major units and sent in minor units.
export function ShippingTab() {
  return (
    <TabFrame
      label={t('settings.tabs.shipping')}
      load={async (client) => {
        const [shipping, info] = await Promise.all([loadShipping(client), loadStoreInfo(client).catch(() => null)])
        if (!shipping) throw new Error('shipping missing')
        return { shipping, country: info?.country ?? null, timeZone: info?.timeZone ?? 'UTC' }
      }}
    >
      {({ data, client, canEdit }) => <ShippingBody shipping={data.shipping} country={data.country} timeZone={data.timeZone} client={client} canEdit={canEdit} />}
    </TabFrame>
  )
}

type Props = { shipping: ShippingSettings; country: string | null; timeZone: string; client: ApiClient; canEdit: boolean }

const postalLabelOf = (country: string | null): string => t(country === 'IN' ? 'settings.shipping.postal.IN' : country === 'US' ? 'settings.shipping.postal.US' : 'settings.shipping.postal.other')

function ShippingBody({ shipping, country, timeZone, client, canEdit }: Props) {
  const { colors } = useTheme()
  const form = useWrite('settingsShipping')
  const [server, setServer] = useState(shipping)
  const [draft, setDraft] = useState(() => draftOf(shipping))
  const [problem, setProblem] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const base = useRef(shipping)
  const latest = useRef(0)
  const currency = server.currency
  const postal = postalLabelOf(country)
  const pricing = server.couriers.find((courier) => courier.status === 'pricing')
  const saved = draftOf(server)
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  const adopt = (next: ShippingSettings) => {
    base.current = next
    setServer(next)
  }

  // Read again after a courier change, a list or someone else's save: what was edited stays, the rest follows the server; only the newest read lands.
  const readBack = async () => {
    const ask = ++latest.current
    const after = await loadShipping(client)
    if (!after || ask !== latest.current) return
    const before = draftOf(base.current)
    adopt(after)
    setDraft((current) => rebase(current, before, draftOf(after)))
  }

  const save = async () => {
    const input = inputOf(draft, server)
    if (typeof input === 'string') {
      form.clear()
      setProblem(t(`settings.shipping.missing.${input}`, { label: postal, example: moneyText({ amount: '4900', currency }) }))
      return
    }
    setProblem(null)
    await form.run(async () => {
      try {
        const revision = await saveShipping(client, base.current.revision, input)
        const next = { ...base.current, ...input, revision }
        adopt(next)
        setDraft(draftOf(next))
        return t('settings.shipping.saved')
      } catch (error) {
        if (isApiError(error, 'STALE')) await readBack().catch(() => undefined)
        throw error
      }
    })
  }

  const threshold = minorOf(draft.threshold, currency)
  const flatShown = draft.flatRate || draft.courierRate
  const failure = problem ?? form.failure

  return (
    <>
      <SectionCard title={t('settings.shipping.chargeTitle')} sub={t('settings.shipping.chargeSub')}>
        <Method label={t('settings.shipping.courierRate')} sub={pricing ? t('settings.shipping.courierRateBy', { name: nameOf(pricing.provider) }) : t('settings.shipping.courierRateNone')} value={draft.courierRate} disabled={!canEdit} onChange={(courierRate) => set({ courierRate })} />
        <Method
          label={t('settings.shipping.flatRate')}
          sub={draft.flatRate || !draft.courierRate ? t('settings.shipping.flatRateSub') : t('settings.shipping.flatFallback')}
          value={draft.flatRate}
          disabled={!canEdit}
          onChange={(flatRate) => set({ flatRate })}
        />
        {flatShown ? <TextField label={t('settings.shipping.flatLabel', { currency })} value={draft.flat} onChangeText={(flat) => set({ flat })} keyboardType="decimal-pad" editable={canEdit} /> : null}
        <Method
          label={t('settings.shipping.pickup')}
          sub={draft.pickup ? t('settings.shipping.pickupOn', { address: server.pickupAddress ?? t('settings.shipping.pickupNoAddress'), hours: draft.hours || t('settings.shipping.noHours') }) : t('settings.shipping.pickupOff')}
          value={draft.pickup}
          disabled={!canEdit}
          onChange={(pickup) => set({ pickup })}
        />
        {draft.pickup ? <TextField label={t('settings.shipping.hoursLabel')} value={draft.hours} onChangeText={(hours) => set({ hours })} placeholder={t('settings.shipping.hoursPlaceholder')} maxLength={pickupHoursMax} editable={canEdit} help={t('settings.shipping.hoursBody')} /> : null}
      </SectionCard>

      <SectionCard title={t('settings.shipping.freeTitle')}>
        <ChoiceRows
          value={draft.freeMode}
          disabled={!canEdit}
          onChange={(freeMode) => set({ freeMode })}
          options={[
            { value: 'never', label: t('settings.shipping.free.never') },
            { value: 'always', label: t('settings.shipping.free.always') },
            { value: 'over', label: t('settings.shipping.free.over'), ...(draft.freeMode === 'over' && typeof threshold === 'string' && threshold !== '0' ? { sub: t('settings.shipping.freeOver', { amount: formatMoney({ amount: threshold, currency }, locale) }) } : {}) },
          ]}
        />
        {draft.freeMode === 'over' ? <TextField label={t('settings.shipping.thresholdLabel', { currency })} value={draft.threshold} onChangeText={(value) => set({ threshold: value })} keyboardType="decimal-pad" editable={canEdit} /> : null}
      </SectionCard>

      <CouriersCard couriers={server.couriers} labelSizes={server.labelSizes} timeZone={timeZone} client={client} canEdit={canEdit} readBack={readBack} />

      <SectionCard title={t('settings.shipping.areaTitle')}>
        <ChoiceRows
          value={draft.areaMode}
          disabled={!canEdit}
          onChange={(areaMode) => set({ areaMode })}
          options={[
            { value: 'everywhere', label: t('settings.shipping.everywhere'), sub: t('settings.shipping.everywhereSub') },
            {
              value: 'list',
              label: t('settings.shipping.list', { label: postal }),
              sub:
                draft.areaMode !== 'list'
                  ? t('settings.shipping.listSub')
                  : server.areaCount > 0
                    ? t('settings.shipping.listFile', { file: server.areaFileName ?? '', count: formatNumber(server.areaCount, locale), sample: server.areaSample.join(', ') })
                    : t('settings.shipping.listNone'),
            },
          ]}
        />
        {draft.areaMode === 'list' && canEdit ? <Button saves kind="secondary" label={t(server.areaCount > 0 ? 'settings.shipping.replace' : 'settings.shipping.paste')} onPress={() => setPasting(true)} /> : null}
        {failure ? <Notice kind="error" text={failure} /> : null}
        {canEdit ? <Button saves busy={form.busy} disabled={same(draft, saved)} label={t('settings.shipping.saveShipping')} onPress={() => void save()} /> : null}
        <Text style={[styles.note, { color: colors.muted }]}>{t('settings.shipping.saveNote')}</Text>
      </SectionCard>

      {pasting ? <CodesSheet country={country} postal={postal} client={client} listMode={draft.areaMode === 'list' && saved.areaMode === 'list'} readBack={readBack} onClose={() => setPasting(false)} /> : null}
    </>
  )
}

function Method({ label, sub, value, disabled, onChange }: { label: string; sub: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  const { colors } = useTheme()
  return (
    <View style={styles.method}>
      <Switch label={label} value={value} disabled={disabled} onChange={onChange} />
      {sub ? <Text style={[styles.note, { color: colors.muted }]}>{sub}</Text> : null}
    </View>
  )
}

function CodesSheet({ country, postal, client, listMode, readBack, onClose }: { country: string | null; postal: string; client: ApiClient; listMode: boolean; readBack: () => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState('')
  const read = readPostalCodes(text, country)
  return (
    <FormSheet
      title={t('settings.shipping.pasteTitle', { label: postal })}
      body={t('settings.shipping.pasteBody', { label: postal })}
      confirm={t('settings.shipping.useList')}
      context="settingsShipping"
      onClose={onClose}
      check={() => (read.kind === 'codes' ? null : read.kind === 'tooMany' ? t('settings.shipping.tooMany', { max: formatNumber(maxPostalCodes, locale) }) : t('settings.shipping.noCodes', { label: postal }))}
      onSubmit={async () => {
        if (read.kind !== 'codes') throw new Error('no codes')
        const kept = await replaceDeliveryArea(client, t('settings.shipping.pastedName'), read.codes)
        await readBack().catch(() => undefined)
        return t(listMode ? 'settings.shipping.areaRead' : 'settings.shipping.areaReadSave', { count: formatNumber(kept, locale), label: postal })
      }}
    >
      <TextArea label={t('settings.shipping.codesLabel', { label: postal })} value={text} onChangeText={setText} lines={6} />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  method: { gap: 2 },
  note: { fontSize: 13, lineHeight: 19 },
})
