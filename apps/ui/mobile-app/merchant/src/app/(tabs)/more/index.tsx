import { useRouter } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { confirmSignOut } from '../../../features/auth/confirmSignOut'
import { Button } from '../../../features/common/Button'
import { PlaceholderScreen } from '../../../features/placeholder/PlaceholderScreen'
import { t } from '../../../messages'
import { session } from '../../../session'

// Until the shell's More screen (#499) exists, these three are how a signed-in person reaches the account.
export default function More() {
  const router = useRouter()
  return (
    <PlaceholderScreen title={t('tabs.more')}>
      <View style={styles.actions}>
        <Button kind="secondary" label={t('placeholder.myProfile')} onPress={() => router.push('/profile')} />
        <Button kind="secondary" label={t('placeholder.switchStore')} onPress={() => session().leaveStore()} />
        <Button kind="secondary" label={t('placeholder.signOut')} onPress={confirmSignOut} />
      </View>
    </PlaceholderScreen>
  )
}

const styles = StyleSheet.create({
  actions: { alignSelf: 'stretch', paddingHorizontal: 24, gap: 10 },
})
