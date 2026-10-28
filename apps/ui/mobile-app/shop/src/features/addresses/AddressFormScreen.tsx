import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { accountOperation, saveAddress, type AccountRead, type Pin } from '../../api/account'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { errorKey } from '../common/errors'
import { Button, Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'
import { AddressFields, checkAddress, draftOf, emptyDraft, type AddressProblems } from './AddressFields'
import type { Draft } from './rules'

function Form({ read, id }: { read: AccountRead; id: string | null }) {
  const router = useRouter()
  const { client } = useShop()
  const { colors } = useTheme()
  const action = useAction()
  const existing = id ? (read.account?.addresses.find((a) => a.id === id) ?? null) : null
  const [draft, setDraft] = useState<Draft>(existing ? draftOf(existing) : emptyDraft(read.countries.length === 1 ? (read.countries[0] ?? '') : ''))
  const [pin, setPin] = useState<Pin | null>(existing?.pin ?? null)
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? (read.account?.addresses.length ?? 0) === 0)
  const [problems, setProblems] = useState<AddressProblems>({})

  const save = async () => {
    const found = checkAddress(draft, pin)
    setProblems(found)
    if (Object.keys(found).length > 0) return
    const done = await action.run(() => saveAddress(client, { id, address: { ...draft, pin }, isDefault }))
    if (done) router.back()
  }

  if (id && !existing) return <StateMessage title={t('addresses.notFound.title')} body={t('addresses.notFound.body')} />

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <AddressFields countries={read.countries} draft={draft} onDraft={setDraft} pin={pin} onPin={setPin} problems={problems} />
      <View style={styles.switchRow}>
        <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{t('address.makeDefault')}</Text>
        <Switch accessibilityLabel={t('address.makeDefault')} value={isDefault} onValueChange={setIsDefault} />
      </View>
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      <Button saves label={t('address.save')} busy={action.busy} onPress={() => void save()} />
    </ScrollView>
  )
}

// A new address, or `id`'s: the pin is required in the app, because own delivery decides by it (api/DELIVERY.md §2).
export function AddressFormScreen({ id }: { id: string | null }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { state, retry } = useOperation(accountOperation())
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t(id ? 'address.edit' : 'address.add')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account/addresses'))} />
      <Resource state={state} onRetry={retry} skeleton="list">
        {(read) => (read.account ? <Form read={read} id={id} /> : <StateMessage title={t('account.guest.title')} body={t('account.guest.body')} />)}
      </Resource>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 14, padding: 16, paddingBottom: 40 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
})
