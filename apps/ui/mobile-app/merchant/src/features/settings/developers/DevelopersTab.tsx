import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadApiKeyChoices, loadApiKeys, type ApiKey, type ApiKeyChoices } from '../../../api/settingsDevelopers'
import { loadSuppliers, type Supplier } from '../../../api/settingsPeople'
import { loadStoreTimeZone } from '../../../api/storeInfo'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { TabFrame } from '../TabFrame'
import { ApiKeysCard } from './ApiKeysCard'
import { SecretCard, type Secret } from './SecretCard'

// `suppliers` is null when they could not be read: a key could then only be made for the whole store, so none is made (ApiKeysCard).

type Reads = { keys: ApiKey[]; choices: ApiKeyChoices | null; suppliers: Supplier[] | null; timeZone: string }

// Settings › Developers (SetDev "developers"; FIRST-RELEASE (store) §15): API keys. The prototype's storefront key and "Websites allowed to
// use it" are not drawn: the Store API neither reads nor changes them (§15, Part 1). Webhooks are their own card.
export function DevelopersTab() {
  return (
    <TabFrame
      label={t('settings.tabs.developers')}
      load={async (client): Promise<Reads> => {
        const [keys, choices, suppliers, timeZone] = await Promise.all([loadApiKeys(client), loadApiKeyChoices(client), loadSuppliers(client).catch(() => null), loadStoreTimeZone(client).catch(() => null)])
        return { keys, choices, suppliers, timeZone: timeZone ?? 'UTC' }
      }}
    >
      {({ data, client, canEdit }) => <DevelopersBody reads={data} client={client} canEdit={canEdit} />}
    </TabFrame>
  )
}

// The list reads itself again after a write rather than the whole tab, so a secret on screen survives it; one that fails to come back
// leaves what was shown.
function DevelopersBody({ reads, client, canEdit }: { reads: Reads; client: ApiClient; canEdit: boolean }) {
  const { colors } = useTheme()
  const [keys, setKeys] = useState(reads.keys)
  const [secret, setSecret] = useState<Secret | null>(null)

  const reloadKeys = async () => {
    try {
      setKeys(await loadApiKeys(client))
    } catch {
      // The write has been said already.
    }
  }

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.developers.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.developers.sub')}</Text>
      </View>
      {secret ? <SecretCard secret={secret} onStored={() => setSecret(null)} /> : null}
      <ApiKeysCard keys={keys} choices={reads.choices} suppliers={reads.suppliers} timeZone={reads.timeZone} client={client} canEdit={canEdit} secretShown={secret !== null} onSecret={setSecret} reload={reloadKeys} />
    </>
  )
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  title: { fontSize: 19, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
