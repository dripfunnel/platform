import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import { Button, TextButton } from '../common/ui'

type Props = {
  visible: boolean
  storeName: string | null
  busy: boolean
  onContinue: () => void
  onNotNow: () => void
}

// Shown before the first request for location, in full, with the store's name (Google Play's prominent disclosure; Apple 5.1.1;
// docs/mobile-app/delivery/FIRST-RELEASE.md §2). Continue goes on to the permission; Not now leaves the rider Offline.
export function LocationDisclosure({ visible, storeName, busy, onContinue, onNotNow }: Props) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const name = storeName ?? t('online.disclosure.thisApp')
  const points = ['what', 'why', 'noTrail'] as const
  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onNotNow}>
      <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('online.disclosure.title', { name })}
        </Text>
        <Text style={{ color: colors.textStrong, fontSize: 16 }}>{t('online.disclosure.intro', { name })}</Text>
        {points.map((point) => (
          <View key={point} style={styles.point}>
            <Text accessibilityRole="header" style={[styles.pointTitle, { color: colors.heading }]}>
              {t(`online.disclosure.${point}Title`)}
            </Text>
            <Text style={{ color: colors.textStrong, fontSize: 16 }}>{t(`online.disclosure.${point}`, { name })}</Text>
          </View>
        ))}
        <Text style={{ color: colors.muted, fontSize: 14 }}>{t('online.disclosure.offlineNote')}</Text>
        <Button label={t('online.disclosure.continue')} busy={busy} onPress={onContinue} />
        <TextButton label={t('online.disclosure.notNow')} disabled={busy} onPress={onNotNow} />
      </ScrollView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' },
  point: { gap: 4 },
  pointTitle: { fontSize: 17, fontWeight: '700' },
})
