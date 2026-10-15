import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme'
import { lineName } from './orderDetail'
import type { PickRow, Picks } from './picks'
import { Stepper } from './Stepper'

type Props = { rows: readonly PickRow[]; picks: Picks; onPick: (lineId: string, quantity: number) => void; sub: (row: PickRow) => string | null }

// Each line that can be picked, with a stepper from none up to what the API says is left (ship, return and refund all pick this way).
export function PickLines({ rows, picks, onPick, sub }: Props) {
  const { colors } = useTheme()
  return (
    <View style={styles.list}>
      {rows.map((row) => {
        const name = lineName(row.line)
        const note = sub(row)
        return (
          <View key={row.line.id} style={styles.row}>
            <View style={styles.name}>
              <Text style={[styles.label, { color: colors.text }]}>{name}</Text>
              {note ? <Text style={[styles.sub, { color: colors.muted }]}>{note}</Text> : null}
            </View>
            <Stepper name={name} value={picks[row.line.id] ?? 0} max={row.max} onChange={(value) => onPick(row.line.id, value)} />
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  row: { gap: 8 },
  name: { gap: 2 },
  label: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  sub: { fontSize: 12 },
})
