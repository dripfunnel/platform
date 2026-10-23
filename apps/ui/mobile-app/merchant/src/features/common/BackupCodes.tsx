import { Share, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from './Button'

// The ten backup codes, shown once and never again (ui/README.md §3): the person saves them by sharing them to a
// note, a password manager or a file. The codes are never logged.
export function BackupCodes({ codes, shareLabel }: { codes: readonly string[]; shareLabel: string }) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.wrap}>
      <View style={[styles.grid, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.button }]}>
        {codes.map((code) => (
          <Text key={code} selectable style={[styles.code, { color: colors.text }]}>
            {code}
          </Text>
        ))}
      </View>
      <Button kind="secondary" label={shareLabel} onPress={() => void Share.share({ message: codes.join('\n') })} />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, padding: 14, rowGap: 8 },
  code: { width: '50%', fontFamily: 'monospace', fontSize: 15 },
})
