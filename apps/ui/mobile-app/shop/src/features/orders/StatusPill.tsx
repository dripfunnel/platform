import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Status } from './status'

/** The status in words, so it is never told by its colour alone. */
export function StatusPill({ status }: { status: Status }) {
  const { colors } = useTheme()
  const tone = {
    success: [colors.successSurface, colors.success],
    warning: [colors.warningSurface, colors.warning],
    danger: [colors.dangerSurface, colors.danger],
    info: [colors.infoSurface, colors.info],
    neutral: [colors.neutralSurface, colors.neutral],
  }[status.tone]
  return (
    <View style={[styles.pill, { backgroundColor: tone[0] }]}>
      <Text style={{ color: tone[1], fontSize: 12, fontWeight: '700' }}>{status.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({ pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 } })
