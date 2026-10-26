import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { regionName } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { accountOperation, deleteAddress, type SavedAddress } from '../../api/account'
import { useShop } from '../../api/ShopContext'
import { locale, t } from '../../messages'
import { errorKey } from '../common/errors'
import { Button, Resource, ScreenHeader, Sheet, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'

const lines = (a: SavedAddress): string => [a.line1, a.line2, a.city, a.region, a.postalCode, a.country ? regionName(a.country, locale) : ''].filter((part) => part.trim() !== '').join(', ')

function AddressCard({ address, onEdit, onDelete }: { address: SavedAddress; onEdit: () => void; onDelete: () => void }) {
  const { colors, radii } = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <View style={styles.head}>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 }}>{address.name}</Text>
        {address.isDefault ? (
          <View style={[styles.tag, { backgroundColor: colors.neutralSurface }]}>
            <Text style={{ color: colors.neutral, fontSize: 12, fontWeight: '700' }}>{t('addresses.default')}</Text>
          </View>
        ) : null}
      </View>
      <Text style={{ color: colors.textStrong, fontSize: 14 }}>{lines(address)}</Text>
      <Text style={{ color: address.pin ? colors.success : colors.warning, fontSize: 13, fontWeight: '600' }}>{address.pin ? t('addresses.pinned') : t('addresses.noPin')}</Text>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button kind="secondary" label={t('addresses.edit')} onPress={onEdit} />
        </View>
        <View style={styles.action}>
          <Button kind="secondary" label={t('addresses.delete')} onPress={onDelete} />
        </View>
      </View>
    </View>
  )
}

export function AddressesScreen() {
  const router = useRouter()
  const { client } = useShop()
  const { colors } = useTheme()
  const { state, retry } = useOperation(accountOperation())
  const action = useAction()
  const [removing, setRemoving] = useState<SavedAddress | null>(null)

  const confirmDelete = async () => {
    if (!removing) return
    const done = await action.run(() => deleteAddress(client, removing.id))
    setRemoving(null)
    if (done) retry()
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('addresses.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
      <ScrollView contentContainerStyle={styles.body}>
        <Resource state={state} onRetry={retry} skeleton="list">
          {({ account }) => {
            if (!account) return <StateMessage title={t('account.guest.title')} body={t('account.guest.body')} />
            return (
              <>
                {action.error ? (
                  <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
                    {t(errorKey(action.error))}
                  </Text>
                ) : null}
                {account.addresses.length === 0 ? <StateMessage title={t('addresses.empty.title')} body={t('addresses.empty.body')} /> : null}
                {account.addresses.map((address) => (
                  <AddressCard key={address.id} address={address} onEdit={() => router.push({ pathname: '/account/address', params: { id: address.id } })} onDelete={() => setRemoving(address)} />
                ))}
                <Button label={t('addresses.add')} onPress={() => router.push('/account/address')} />
              </>
            )
          }}
        </Resource>
      </ScrollView>
      {removing ? (
        <Sheet title={t('addresses.deleteTitle')} onClose={() => setRemoving(null)}>
          <Text style={{ color: colors.textStrong, fontSize: 15, paddingBottom: 12 }}>{t('addresses.deleteBody', { name: removing.name })}</Text>
          <Button label={t('addresses.deleteConfirm')} busy={action.busy} onPress={() => void confirmDelete()} />
          <Button kind="secondary" label={t('common.cancel')} onPress={() => setRemoving(null)} />
        </Sheet>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 12, padding: 16, paddingBottom: 40 },
  card: { gap: 6, padding: 14, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { paddingHorizontal: 8, height: 24, borderRadius: 6, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 6 },
  action: { flex: 1 },
})
