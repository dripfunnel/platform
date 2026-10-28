import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'

type Props = {
  online: boolean
  /** Why the line under the title reads as it does. */
  paused: boolean
  locationOff: boolean
  busy: boolean
  onToggle: () => void
}

// The Online switch and what it says (docs/mobile-app/delivery/FIRST-RELEASE.md §2).
export function OnlineCard({ online, paused, locationOff, busy, onToggle }: Props) {
  const { colors, radii } = useTheme()
  const sub = locationOff ? t('online.subLocationOff') : !online ? t('online.subOffline') : paused ? t('online.subPaused') : t('online.subOnline')
  return (
    <View style={[styles.card, { backgroundColor: online ? colors.successSurface : colors.surface, borderColor: online ? colors.successBorder : colors.border, borderRadius: radii.card }]}>
      <View style={styles.words}>
        <Text accessibilityRole="header" style={[styles.title, { color: online ? colors.success : colors.heading }]}>
          {online ? t('online.on') : t('online.off')}
        </Text>
        <Text style={{ color: online ? colors.success : colors.muted, fontSize: 13 }}>{sub}</Text>
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={t('online.switch')}
        accessibilityState={{ checked: online, disabled: locationOff || busy, busy }}
        disabled={locationOff || busy}
        onPress={onToggle}
        style={[styles.track, { backgroundColor: online ? colors.success : colors.neutral, opacity: locationOff || busy ? 0.5 : 1 }]}
      >
        <View style={[styles.knob, { left: online ? 36 : 4, backgroundColor: colors.surface }]} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderWidth: 1 },
  words: { flex: 1, gap: 2 },
  title: { fontSize: 22, fontWeight: '800' },
  track: { width: 76, height: 44, borderRadius: 22 },
  knob: { position: 'absolute', top: 4, width: 36, height: 36, borderRadius: 18 },
})
