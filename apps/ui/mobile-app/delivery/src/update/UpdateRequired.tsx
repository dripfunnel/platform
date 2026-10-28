import { Linking, StyleSheet, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../messages'
import { StateMessage } from '../features/common/ui'

/** The store's newest APK, at the link in the invitation text (docs/api/DELIVERY.md §5). */
export const apkLink = (host: string): string => `https://${host}/app/delivery.apk`

export function UpdateRequired({ host }: { host: string }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.screen, { backgroundColor: colors.surface }]}>
      <StateMessage title={t('update.title')} body={t('update.body')} actionLabel={t('update.download')} onAction={() => void Linking.openURL(apkLink(host))} />
    </View>
  )
}

const styles = StyleSheet.create({ screen: { flex: 1, justifyContent: 'center' } })
