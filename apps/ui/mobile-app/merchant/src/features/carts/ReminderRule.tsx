import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Switch } from '../common/Switch'

type Props = { title: string; body: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }

// One rule of who gets reminded: its switch, and what it means under it.
export function ReminderRule({ title, body, value, disabled, onChange }: Props) {
  const { colors } = useTheme()
  return (
    <View style={styles.rule}>
      <Switch label={title} value={value} disabled={disabled} onChange={onChange} />
      <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  rule: { gap: 2 },
  body: { fontSize: 13, lineHeight: 18, paddingLeft: 48 },
})
