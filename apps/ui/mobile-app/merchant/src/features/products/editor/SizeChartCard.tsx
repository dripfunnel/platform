import { Pressable, StyleSheet, Text } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Caret } from '../../common/Caret'
import { SectionCard } from '../../common/SectionCard'
import { useFeedback } from '../../shell/Feedback'
import type { Draft } from './draft'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; charts: { id: string; name: string }[] | 'failed'; disabled: boolean }

// The size chart a physical product uses (CATALOG-DESIGN.md R6): one of the store's, or none. The charts themselves are made under
// Catalogue › Collections.
export function SizeChartCard({ draft, update, charts, disabled }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const failed = charts === 'failed'
  const list = failed ? [] : charts
  const current = draft.sizeChart.id === null ? t('products.sizeChart.none') : (list.find((chart) => chart.id === draft.sizeChart.id)?.name ?? t('products.sizeChart.attached'))
  const choose = (id: string | null) => update((d) => ({ ...d, sizeChart: { ...d.sizeChart, id } }))

  return (
    <SectionCard title={t('products.sizeChart.title')} sub={draft.sizeChart.id === null ? t('products.sizeChart.hint') : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('products.sizeChart.title')}: ${current}`}
        disabled={disabled || failed}
        onPress={() =>
          feedback.menu({
            title: t('products.sizeChart.pick'),
            items: [
              { key: 'none', label: `${draft.sizeChart.id === null ? '✓ ' : ''}${t('products.sizeChart.none')}`, onPress: () => choose(null) },
              ...list.map((chart) => ({ key: chart.id, label: `${chart.id === draft.sizeChart.id ? '✓ ' : ''}${chart.name}`, onPress: () => choose(chart.id) })),
            ],
          })
        }
        style={[styles.select, { borderColor: colors.fieldBorder, borderRadius: radii.button, opacity: disabled || failed ? 0.6 : 1 }]}
      >
        <Text style={[styles.text, { color: colors.text }]}>
          {current}
          <Caret color={colors.text} />
        </Text>
      </Pressable>
      {failed ? (
        <Text accessibilityRole="alert" style={[styles.note, { color: colors.danger }]}>
          {t('products.sizeChart.failed')}
        </Text>
      ) : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  select: { minHeight: 50, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center' },
  text: { fontSize: 15 },
  note: { fontSize: 13, lineHeight: 19 },
})
