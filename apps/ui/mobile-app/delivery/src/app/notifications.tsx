import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../features/common/ui'
import { t } from '../messages'
import { askAndRegister, markAsked } from '../push/push'
import { useSession } from '../session/SessionContext'

// Why we ask, then the system prompt, once, at the first sign-in (docs/mobile-app/delivery/FIRST-RELEASE.md §2). A refusal is shown on Home.
export default function Notifications() {
  const router = useRouter()
  const { colors } = useTheme()
  const { client } = useSession()
  const [busy, setBusy] = useState(false)
  const next = async () => {
    setBusy(true)
    await markAsked().catch(() => undefined)
    await askAndRegister(client)
    router.replace('/home')
  }
  return (
    <View style={[styles.page, { backgroundColor: colors.page }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('notifications.title')}
      </Text>
      <Text style={{ color: colors.textStrong, fontSize: 16 }}>{t('notifications.body')}</Text>
      <Button label={t('notifications.continue')} busy={busy} onPress={() => void next()} />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 24, fontWeight: '800' },
})
