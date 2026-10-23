import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { t } from '../../messages'
import { Icon } from '../shell/Icon'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { duplicateHeads, noValue, withHead, withoutColumn, type ChartDraft } from './sizeChartDraft'

type Props = { draft: ChartDraft; onChange: (next: ChartDraft) => void; disabled: boolean; canEdit: boolean; invalid: { columns: boolean; duplicate: boolean; sizes: boolean } }

const cellWidth = 112

// The chart as a grid you can type in (CatSizeCharts, R3): sizes down the side, size systems then measurements across. It is wider than
// a phone, so it scrolls sideways, as the prototype's does under its minimum width. An empty cell shows "—".
export function ChartGrid({ draft, onChange, disabled, canEdit, invalid }: Props) {
  const { colors } = useTheme()
  const columns = [...draft.systems, ...draft.measurements]
  const doubled = duplicateHeads(draft)
  const setCell = (row: number, col: number, value: string) =>
    onChange({ ...draft, rows: draft.rows.map((r, i) => (i === row ? (col < 0 ? { ...r, size: value } : { ...r, values: r.values.map((v, j) => (j === col ? value : v)) }) : r)) })

  const input = (label: string, value: string, onChangeText: (value: string) => void, bad: boolean, head: boolean) => (
    <TextInput
      accessibilityLabel={label}
      value={value}
      editable={!disabled}
      maxLength={head ? 40 : 20}
      placeholder={head ? undefined : noValue}
      placeholderTextColor={colors.muted}
      onChangeText={onChangeText}
      style={[styles.cell, { color: colors.text, borderColor: bad ? colors.danger : colors.border, backgroundColor: head ? colors.page : colors.surface, fontWeight: head ? '700' : '400' }]}
    />
  )

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel={draft.name} contentContainerStyle={styles.grid}>
      <View>
        <View style={styles.row}>
          <Text style={[styles.cell, styles.fixed, { color: colors.text, borderColor: colors.border, backgroundColor: colors.page }]}>{t('collections.charts.sizeHead')}</Text>
          {columns.map((h, i) => (
            <View key={i} style={styles.headCell}>
              {input(t('collections.charts.headCell', { n: i + 2 }), h, (value) => onChange(withHead(draft, i, value)), (invalid.columns && h.trim() === '') || (invalid.duplicate && doubled.has(i)), true)}
              {canEdit && (i < draft.systems.length || draft.measurements.length > 1) ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('collections.charts.removeColumn', { name: h || String(i + 2) })} disabled={disabled} onPress={() => onChange(withoutColumn(draft, i))} style={styles.headRemove}>
                  <Icon name="close" size={16} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        {draft.rows.map((r, i) => (
          <View key={i} style={styles.row}>
            {input(t('collections.charts.sizeCell', { n: i + 1 }), r.size, (value) => setCell(i, -1, value), invalid.sizes && r.size.trim() === '', false)}
            {r.values.map((v, j) => (
              <View key={j}>{input(t('collections.charts.cell', { size: r.size || String(i + 1), column: columns[j] ?? '' }), v, (value) => setCell(i, j, value), false, false)}</View>
            ))}
            {canEdit ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('collections.charts.removeRow', { size: r.size || String(i + 1) })} disabled={disabled || draft.rows.length === 1} onPress={() => onChange({ ...draft, rows: draft.rows.filter((_, j) => j !== i) })} style={styles.remove}>
                <Icon name="close" size={16} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  grid: { paddingRight: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  cell: { width: cellWidth, height: 44, borderWidth: 1, paddingHorizontal: 10, fontSize: 14, fontVariant: ['tabular-nums'] },
  fixed: { textAlignVertical: 'center', paddingTop: 12, fontWeight: '700' },
  headCell: { width: cellWidth },
  headRemove: { position: 'absolute', right: 0, top: 0, width: 30, height: 44, alignItems: 'center', justifyContent: 'center' },
  remove: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
})
