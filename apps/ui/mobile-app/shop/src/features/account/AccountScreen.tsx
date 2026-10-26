import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { accountOperation, renameAccount, type Account } from '../../api/account'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { errorKey } from '../common/errors'
import { Field } from '../common/fields'
import { Button, Resource, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'

function SignedOut() {
  const router = useRouter()
  return (
    <View style={styles.guest}>
      <StateMessage title={t('account.guest.title')} body={t('account.guest.body')} />
      <Button label={t('auth.signInButton')} onPress={() => router.push('/sign-in')} />
      <Button kind="secondary" label={t('auth.create')} onPress={() => router.push('/register')} />
    </View>
  )
}

function Details({ account, onRenamed }: { account: Account; onRenamed: () => void }) {
  const { client } = useShop()
  const { colors, radii } = useTheme()
  const action = useAction()
  const [name, setName] = useState(account.name ?? '')
  const changed = name.trim() !== (account.name ?? '')

  const save = async () => {
    const done = await action.run(() => renameAccount(client, name))
    if (done) onRenamed()
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Field label={t('account.name')} value={name} onChangeText={setName} optional autoComplete="name" textContentType="name" />
      {account.email ? (
        <Text style={{ color: colors.textStrong, fontSize: 15 }} accessibilityLabel={`${t('auth.email')}: ${account.email}`}>
          {account.email}
        </Text>
      ) : null}
      {account.phone ? (
        <Text style={{ color: colors.textStrong, fontSize: 15 }} accessibilityLabel={`${t('auth.phone')}: ${account.phone}`}>
          {account.phone}
        </Text>
      ) : null}
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      {changed ? <Button label={t('account.saveName')} busy={action.busy} onPress={() => void save()} /> : null}
    </View>
  )
}

function Profile() {
  const router = useRouter()
  const { endSession } = useShop()
  const { colors, radii } = useTheme()
  const { state, retry } = useOperation(accountOperation())
  const action = useAction()

  // The API knowing no account for the token (it ended, or was revoked) means the phone should stop holding it.
  const gone = state.status === 'ready' && state.data.account === null
  useEffect(() => {
    if (gone) void endSession()
  }, [gone, endSession])
  if (gone) return <SignedOut />

  return (
    <Resource state={state} onRetry={retry} skeleton="list">
      {({ account }) =>
        account ? (
          <View style={styles.profile}>
            <Details key={account.name ?? ''} account={account} onRenamed={retry} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('account.addresses', { count: account.addresses.length })}
              onPress={() => router.push('/account/addresses')}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
            >
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{t('account.addressesTitle')}</Text>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{t('account.addresses', { count: account.addresses.length })}</Text>
            </Pressable>
            <Button kind="secondary" label={t('account.signOut')} busy={action.busy} onPress={() => void action.run(endSession)} />
          </View>
        ) : null
      }
    </Resource>
  )
}

export function AccountScreen() {
  const { signedIn } = useShop()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.page }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('tabs.account')}
      </Text>
      {signedIn ? <Profile /> : <SignedOut />}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { gap: 16, padding: 16, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700' },
  guest: { gap: 12 },
  profile: { gap: 14 },
  card: { gap: 12, padding: 14, borderWidth: 1 },
  row: { minHeight: 64, justifyContent: 'center', gap: 2, paddingHorizontal: 14, borderWidth: 1 },
})
