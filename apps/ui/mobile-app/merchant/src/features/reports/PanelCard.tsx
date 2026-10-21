import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { LinkButton } from '../common/LinkButton'
import type { PanelView } from './reportView'

type Props = { panel: PanelView; disabled: boolean; onExport: () => void }

// One panel of PortalReports as a card (DESIGN.md §4): its title with Export, the big figure and its change, ranked rows with bars, and its note.
export function PanelCard({ panel, disabled, onExport }: Props) {
  const { colors, radii } = useTheme()
  const tone = { up: colors.success, down: colors.link, muted: colors.muted }
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {panel.title}
        </Text>
        <LinkButton label={t('reports.exportPanel')} accessibilityLabel={t('reports.exportPanelLabel', { panel: panel.title })} disabled={disabled} onPress={onExport} />
      </View>
      {panel.big ? <Text style={[styles.big, { color: colors.heading }]}>{panel.big}</Text> : null}
      {panel.delta ? <Text style={[styles.small, { color: tone[panel.delta.tone] }]}>{panel.delta.text}</Text> : null}
      {panel.rows.map((row) => (
        <View key={row.key} style={[styles.row, { borderTopColor: colors.border }]}>
          <View style={styles.line}>
            <Text style={[styles.label, { color: colors.text }]}>{row.label}</Text>
            <Text style={[styles.value, { color: row.refund ? colors.link : colors.text }]}>{row.value}</Text>
          </View>
          {row.bar !== undefined ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.track, { backgroundColor: colors.neutralSurface }]}>
              <View style={[styles.fill, { backgroundColor: colors.focus, width: `${row.bar}%` }]} />
            </View>
          ) : null}
        </View>
      ))}
      {panel.none ? <Text style={[styles.small, styles.none, { color: colors.muted, borderTopColor: colors.border }]}>{panel.none}</Text> : null}
      <Text style={[styles.small, { color: colors.muted }]}>{panel.note}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '800' },
  big: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  small: { fontSize: 12, lineHeight: 18 },
  row: { gap: 4, paddingTop: 8, borderTopWidth: 1 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  label: { flex: 1, fontSize: 13 },
  value: { fontSize: 13, fontVariant: ['tabular-nums'] },
  track: { height: 5, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 5 },
  none: { paddingTop: 10, borderTopWidth: 1, fontSize: 13 },
})
