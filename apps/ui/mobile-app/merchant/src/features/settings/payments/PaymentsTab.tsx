import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { connectKeys, disconnectGateway, loadGateways, turnOnMethod, type Gateway, type PaymentMode } from '../../../api/settingsPayments'
import { loadStoreInfo } from '../../../api/settingsStore'
import type { ApiClient } from '../../../graphql'
import { regionName } from '../../../format'
import { locale, t, tryT } from '../../../messages'
import { useTheme } from '../../../theme'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { TextArea } from '../../common/TextArea'
import { useFeedback } from '../../shell/Feedback'
import { ChoiceRows } from '../ChoiceRows'
import { FormSheet } from '../FormSheet'
import { openPortal, paymentsPortalPath } from '../portalLink'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { useRefreshOnReturn } from '../useRefreshOnReturn'
import { actionsFor, bankDetailsMax, isConnected, keyFields, keysComplete, keysOf, standingOf, type GatewayAction, type KeyName } from './gatewayView'

// Settings › Payment setup (SetOps "payments"; FIRST-RELEASE (store) §15): the region's ways to pay. Stripe connects on the portal in the phone's browser and the
// list is read again when the person comes back; the other card providers take their own named keys, never read back; cash on delivery and bank transfer are
// turned on here. Nothing secret is shown: a webhook address is the provider's to paste, not a key.
export function PaymentsTab() {
  return (
    <TabFrame
      label={t('settings.tabs.payments')}
      load={async (client) => {
        const [gateways, info] = await Promise.all([loadGateways(client), loadStoreInfo(client).catch(() => null)])
        return { gateways, country: info?.country ?? null }
      }}
    >
      {({ data, client, canEdit, refresh }) => <PaymentsBody gateways={data.gateways} country={data.country} client={client} canEdit={canEdit} refresh={refresh} />}
    </TabFrame>
  )
}

type Props = { gateways: readonly Gateway[]; country: string | null; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }
type Sheet = { kind: 'stripe' } | { kind: 'keys' | 'bank' | 'cod' | 'off'; gateway: Gateway }

function PaymentsBody({ gateways, country, client, canEdit, refresh }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const close = () => setSheet(null)
  useRefreshOnReturn(refresh)

  if (gateways.length === 0) {
    return (
      <SectionCard title={t('settings.payments.emptyTitle')}>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.payments.emptyBody')}</Text>
      </SectionCard>
    )
  }

  const open = (gateway: Gateway, action: GatewayAction) => {
    if (action === 'connect') setSheet(gateway.provider === 'stripe' ? { kind: 'stripe' } : { kind: 'keys', gateway })
    else if (action === 'changeKeys') setSheet({ kind: 'keys', gateway })
    else if (action === 'setUp') setSheet({ kind: gateway.provider === 'bank_transfer' ? 'bank' : 'cod', gateway })
    else if (action === 'changeDetails') setSheet({ kind: 'bank', gateway })
    else setSheet({ kind: 'off', gateway })
  }

  // One way forward that changes nothing yet opens its sheet; anything that turns something off waits behind a menu.
  const choose = (gateway: Gateway) => {
    const actions = actionsFor(gateway)
    const [only] = actions
    if (only && actions.length === 1 && only !== 'disconnect' && only !== 'turnOff') return open(gateway, only)
    feedback.menu({
      title: gateway.label,
      items: actions.map((action) => ({ key: action, label: t(`settings.payments.${action}`), danger: action === 'disconnect' || action === 'turnOff', onPress: () => open(gateway, action) })),
    })
  }

  const subOf = (gateway: Gateway): string => {
    const connected = isConnected(gateway)
    return [
      tryT(`settings.payments.desc.${gateway.provider}`),
      !gateway.connectable && !connected ? t('settings.payments.notOffered', { name: gateway.label }) : undefined,
      connected && !gateway.live ? t('settings.payments.testOnly') : undefined,
      gateway.provider === 'bank_transfer' && gateway.live && gateway.bankDetails ? t('settings.payments.bankShown', { details: gateway.bankDetails }) : undefined,
      ...gateway.connections.filter((c) => c.webhookUrl).map((c) => `${t('settings.payments.webhook', { mode: t(`settings.payments.modes.${c.mode}`), name: gateway.label })} ${c.webhookUrl}`),
    ]
      .filter(Boolean)
      .join('\n')
  }

  const row = (gateway: Gateway) => {
    const actions = actionsFor(gateway)
    const standing = standingOf(gateway)
    const [only] = actions
    const direct = only !== undefined && actions.length === 1 && only !== 'disconnect' && only !== 'turnOff'
    return (
      <RowCard
        key={gateway.provider}
        title={gateway.label}
        sub={subOf(gateway)}
        status={t(`settings.payments.status.${standing}`)}
        tone={standing === 'live' ? 'ok' : standing === 'test' ? 'wait' : 'off'}
        onPress={canEdit && actions.length > 0 ? () => choose(gateway) : null}
        accessibilityLabel={t(direct && only ? `settings.payments.${only}Name` : 'settings.payments.manageName', { name: gateway.label })}
      />
    )
  }

  const cards = gateways.filter((gateway) => gateway.kind === 'gateway')
  const others = gateways.filter((gateway) => gateway.kind === 'other')
  const countryName = country ? regionName(country, locale) : ''

  return (
    <>
      {cards.length > 0 ? (
        <SectionCard title={t('settings.payments.gatewaysTitle')} sub={t('settings.payments.gatewaysSub')}>
          {cards.map(row)}
          <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.payments.gatewaysNote', { country: countryName })}</Text>
        </SectionCard>
      ) : null}
      {others.length > 0 ? (
        <SectionCard title={t('settings.payments.otherTitle')} sub={t('settings.payments.otherSub')}>
          {others.map(row)}
        </SectionCard>
      ) : null}

      {sheet?.kind === 'stripe' ? (
        <FormSheet
          title={t('settings.payments.stripeTitle')}
          body={t('settings.payments.stripeBody')}
          confirm={t('settings.payments.stripeGo')}
          context="settingsPayments"
          onClose={close}
          onSubmit={async () => {
            await openPortal(paymentsPortalPath)
            return t('settings.payments.stripeOpened')
          }}
        />
      ) : null}
      {sheet?.kind === 'keys' ? <KeysSheet gateway={sheet.gateway} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'bank' ? <BankSheet gateway={sheet.gateway} country={country} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'cod' ? (
        <FormSheet
          title={t('settings.payments.setUpTitle', { name: sheet.gateway.label })}
          body={t('settings.payments.codBody')}
          confirm={t('settings.payments.turnOn')}
          context="settingsPayments"
          onClose={close}
          onSubmit={async () => {
            await turnOnMethod(client, sheet.gateway.provider, null)
            await refresh()
            return t('settings.payments.turnedOn', { name: sheet.gateway.label })
          }}
        />
      ) : null}
      {sheet?.kind === 'off' ? <OffSheet gateway={sheet.gateway} client={client} onClose={close} onDone={refresh} /> : null}
    </>
  )
}

type DoneProps = { gateway: Gateway; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

function OffSheet({ gateway, client, onClose, onDone }: DoneProps) {
  const card = gateway.kind === 'gateway'
  return (
    <FormSheet
      title={t(card ? 'settings.payments.disconnectTitle' : 'settings.payments.turnOffTitle', { name: gateway.label })}
      body={t(card ? 'settings.payments.disconnectBody' : 'settings.payments.offBody')}
      confirm={t(card ? 'settings.payments.disconnect' : 'settings.payments.turnOff')}
      danger
      context="settingsPayments"
      onClose={onClose}
      onSubmit={async () => {
        await disconnectGateway(client, gateway.provider)
        await onDone()
        return t(card ? 'settings.payments.disconnected' : 'settings.payments.turnedOff', { name: gateway.label })
      }}
    />
  )
}

function BankSheet({ gateway, country, client, onClose, onDone }: DoneProps & { country: string | null }) {
  const [details, setDetails] = useState(gateway.bankDetails ?? '')
  return (
    <FormSheet
      title={t(gateway.live ? 'settings.payments.changeDetailsTitle' : 'settings.payments.setUpTitle', { name: gateway.label })}
      body={t('settings.payments.bankBody')}
      confirm={t(gateway.live ? 'settings.payments.changeDetails' : 'settings.payments.turnOn')}
      context="settingsPayments"
      onClose={onClose}
      check={() => (details.trim() === '' ? t('settings.payments.bankMissing') : details.trim().length > bankDetailsMax ? t('settings.payments.bankTooLong', { max: bankDetailsMax }) : null)}
      onSubmit={async () => {
        await turnOnMethod(client, gateway.provider, details.trim())
        await onDone()
        return t(gateway.live ? 'settings.payments.detailsSaved' : 'settings.payments.turnedOn', { name: gateway.label })
      }}
    >
      <TextArea label={t('settings.payments.bankLabel')} value={details} onChangeText={setDetails} placeholder={t(country === 'IN' ? 'settings.payments.bankPlaceholderIN' : 'settings.payments.bankPlaceholder')} />
    </FormSheet>
  )
}

function KeysSheet({ gateway, client, onClose, onDone }: DoneProps) {
  const fields = keyFields[gateway.provider] ?? []
  const [mode, setMode] = useState<PaymentMode>(isConnected(gateway) && !gateway.live ? 'test' : 'live')
  const [values, setValues] = useState<Partial<Record<KeyName, string>>>({})
  return (
    <FormSheet
      title={t(isConnected(gateway) ? 'settings.payments.changeKeysTitle' : 'settings.payments.connectTitle', { name: gateway.label })}
      body={t('settings.payments.keysBody', { name: gateway.label })}
      confirm={t('settings.payments.connect')}
      context="settingsPayments"
      onClose={onClose}
      check={() => (keysComplete(gateway.provider, values) ? null : t('settings.payments.keysMissing'))}
      onSubmit={async () => {
        await connectKeys(client, gateway.provider, mode, keysOf(gateway.provider, values))
        await onDone()
        return t(mode === 'live' ? 'settings.payments.connectedLive' : 'settings.payments.connectedTest', { name: gateway.label })
      }}
    >
      <ChoiceRows
        label={t('settings.payments.keysMode')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'live', label: t('settings.payments.keysModes.live') },
          { value: 'test', label: t('settings.payments.keysModes.test') },
        ]}
      />
      {fields.map((field) => (
        <TextField key={field.name} label={t(`settings.payments.fields.${field.name}`)} value={values[field.name] ?? ''} secret={field.secret} autoComplete="off" onChangeText={(value) => setValues({ ...values, [field.name]: value })} />
      ))}
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  sub: { fontSize: 13, lineHeight: 19 },
})
