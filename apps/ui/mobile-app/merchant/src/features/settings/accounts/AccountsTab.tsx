import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { loadCustomerAccounts, saveCustomerAccounts, signInModes, type CustomerAccounts, type SignInMode } from '../../../api/settingsAccounts'
import { loadStoreInfo } from '../../../api/settingsStore'
import { formatNumber } from '../../../format'
import type { ApiClient } from '../../../graphql'
import { locale, t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { ChoiceRows } from '../ChoiceRows'
import { FormSheet } from '../FormSheet'
import { TabFrame } from '../TabFrame'

// Settings › Customer accounts (SetAccess "customers"; ACCESS.md §2.1; FIRST-RELEASE (store) §15): how shoppers sign in, and what they see. Codes go by text
// only, as the API sends them (the prototype's WhatsApp waits for a sender).
export function AccountsTab() {
  return (
    <TabFrame
      label={t('settings.tabs.accounts')}
      load={async (client) => {
        const [accounts, info] = await Promise.all([loadCustomerAccounts(client), loadStoreInfo(client).catch(() => null)])
        if (!accounts) throw new Error('customer accounts missing')
        return { accounts, country: info?.country ?? null }
      }}
    >
      {({ data, client, canEdit }) => <AccountsBody accounts={data.accounts} country={data.country} client={client} canEdit={canEdit} />}
    </TabFrame>
  )
}

type Props = { accounts: CustomerAccounts; country: string | null; client: ApiClient; canEdit: boolean }

function AccountsBody({ accounts, country, client, canEdit }: Props) {
  const { colors } = useTheme()
  const [saved, setSaved] = useState(accounts)
  const [mode, setMode] = useState<SignInMode>(accounts.mode)
  const [asking, setAsking] = useState(false)
  const india = country === 'IN'
  // Phone-only shoppers can't sign in to a store taking email only until ACCESS.md §2.1's add-an-email step exists.
  const dropsMobile = saved.mode !== 'email' && mode === 'email' && saved.phoneOnly > 0
  const warning = dropsMobile ? tCount('settings.accounts.dropsMobile', saved.phoneOnly, { total: formatNumber(saved.phoneOnly, locale) }) : null

  return (
    <>
      <SectionCard title={t('settings.accounts.title')} sub={t('settings.accounts.sub')}>
        <ChoiceRows
          label={t('settings.accounts.modesLabel')}
          value={mode}
          disabled={!canEdit}
          onChange={setMode}
          options={signInModes.map((value) => ({ value, label: t(`settings.accounts.modes.${value}.label`), sub: t(`settings.accounts.modes.${value}.sub`) + (value === 'both' && india ? t('settings.accounts.bothIndia') : '') }))}
        />
      </SectionCard>
      {warning ? <Notice text={warning} /> : null}
      <SectionCard title={t('settings.accounts.seeTitle')}>
        <Text style={[styles.text, { color: colors.text }]}>{t(`settings.accounts.see.${mode}`)}</Text>
        <Text style={[styles.text, { color: colors.text }]}>
          {t('settings.accounts.guests', { key: t(`settings.accounts.guestKey.${mode}`), phone: mode === 'email' ? '' : t('settings.accounts.guestPhone') })}
        </Text>
        {mode !== 'email' ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.accounts.sms', { service: t(india ? 'settings.accounts.smsServices.IN' : 'settings.accounts.smsServices.other') })}</Text> : null}
      </SectionCard>
      <Text style={[styles.sub, { color: colors.muted }]}>
        {t('settings.accounts.counts', { customers: tCount('settings.accounts.customersCount', saved.customers, { total: formatNumber(saved.customers, locale) }), email: formatNumber(saved.withEmail, locale), phone: formatNumber(saved.withPhone, locale) })}
      </Text>
      {canEdit ? <Button saves disabled={mode === saved.mode} label={t('settings.common.save')} onPress={() => setAsking(true)} /> : null}

      {asking ? (
        <FormSheet
          title={t('settings.accounts.askTitle')}
          body={[t('settings.accounts.askBody'), warning].filter(Boolean).join(' ')}
          confirm={t('settings.common.save')}
          context="settingsAccounts"
          onClose={() => setAsking(false)}
          onSubmit={async () => {
            const next = await saveCustomerAccounts(client, mode)
            if (next) {
              setSaved(next)
              setMode(next.mode)
            }
            return t('settings.accounts.saved')
          }}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 14, lineHeight: 21 },
  sub: { fontSize: 13, lineHeight: 19 },
})
