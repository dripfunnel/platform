import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useBrand } from '@dripfunnel/mobile-shared/brand'
import { t } from '../messages'
import { Button } from '../features/common/ui'
import type { usePushAsk } from './usePushAsk'

/** The offer to turn notifications on, in the store's name and in plain words about what is and is not in them. */
export function PushOffer({ ask }: { ask: ReturnType<typeof usePushAsk> }) {
  const { colors, radii } = useTheme()
  const { brand } = useBrand()
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={{ color: colors.heading, fontSize: 16, fontWeight: '800' }}>
        {t('push.title')}
      </Text>
      <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('push.body', { store: brand?.name ?? t('push.store') })}</Text>
      {ask.failed ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
          {t('push.failed')}
        </Text>
      ) : null}
      <Button label={t('push.allow')} busy={ask.busy} onPress={() => void ask.enable()} />
      <Button kind="secondary" label={t('push.later')} onPress={() => void ask.later()} />
    </View>
  )
}

const styles = StyleSheet.create({ card: { gap: 10, padding: 14, borderWidth: 1 } })
