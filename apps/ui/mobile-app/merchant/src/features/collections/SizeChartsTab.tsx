import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { loadSizeChartList, saveSizeChart } from '../../api/sizeCharts'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { sessionClient } from '../../session'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { SectionCard } from '../common/SectionCard'
import { useLoad } from '../common/useLoad'
import { useFeedback } from '../shell/Feedback'
import { Skeleton } from '../states/StateView'
import type { AreaFacts } from './areaData'
import { chartInput, templates, type TemplateKey } from './sizeChartDraft'
import { sizeChartHref } from './routes'
import { templateWords } from './templateWords'
import { useReloadOnFocus } from './useReloadOnFocus'

type Props = { facts: AreaFacts; canEdit: boolean }

// CatSizeCharts at phone width: the store's own charts as cards (a supplier's are its own, FIRST-RELEASE.md §12), and a start from a
// template in the store's unit, which makes the chart and opens it. The chart itself is edited on its own screen.
export function SizeChartsTab({ facts, canEdit }: Props) {
  const { colors, radii } = useTheme()
  const router = useRouter()
  const feedback = useFeedback()
  const client = sessionClient()
  const list = useLoad(() => loadSizeChartList(client), [client])
  useReloadOnFocus(list.reload)

  if (list.state.status === 'loading') return <Skeleton />
  if (list.state.status === 'error') {
    return (
      <SectionCard title={t('collections.charts.loadFailed.title')} sub={t('collections.charts.loadFailed.body')}>
        <Button kind="secondary" label={t('collections.charts.retry')} onPress={list.reload} />
      </SectionCard>
    )
  }

  const charts = list.state.data.charts.filter((c) => c.supplierId === null)
  const limit = list.state.data.limit
  const own = charts.length
  const atLimit = own >= limit
  const blocked = facts.sizeCharts.inPlan === false
  const india = facts.currency === 'INR'

  const create = async (key: TemplateKey) => {
    const template = templates(facts.unit, india, templateWords()).find((x) => x.key === key)
    if (!template) return
    try {
      const made = await saveSizeChart(client, null, null, chartInput({ id: null, revision: null, name: t(`collections.charts.newName.${key}`), unit: facts.unit, ...template.chart, fitNotes: '', howToMeasure: [], modelInfo: null }))
      feedback.toast({ message: t('collections.charts.created') })
      router.push(sizeChartHref(made.id) as never)
    } catch (error) {
      feedback.toast({ message: errorMessage(error, 'sizeCharts') })
    }
  }

  const start = () => {
    if (atLimit) return feedback.toast({ message: t('collections.charts.atLimit') })
    feedback.sheet({
      title: t('collections.charts.startTitle'),
      body: t('collections.charts.startBody', { unit: t(facts.unit === 'in' ? 'collections.charts.unitIn' : 'collections.charts.unitCm') }),
      choices: templates(facts.unit, india, templateWords()).map((x) => ({ value: x.key, label: t(`collections.charts.templates.${x.key}`), sub: t(`collections.charts.templates.${x.key}Sub`) })),
      confirm: t('collections.charts.create'),
      saves: true,
      onConfirm: ({ choice }) => create((choice as TemplateKey | null) ?? 'tops'),
    })
  }

  return (
    <View style={styles.list}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('collections.charts.title')}
        </Text>
        <Text style={[styles.sub, { color: atLimit ? colors.warning : colors.muted }]}>{t('collections.charts.meter', { count: own, limit })}</Text>
      </View>
      {facts.sizeCharts.inPlan !== null && !facts.sizeCharts.enabled ? <Text style={[styles.note, { color: colors.warning, backgroundColor: colors.warningSurface, borderRadius: radii.button }]}>{t('collections.charts.offNote')}</Text> : null}
      {blocked ? <Text style={[styles.note, { color: colors.warning, backgroundColor: colors.warningSurface, borderRadius: radii.button }]}>{t('collections.charts.notInPlan')}</Text> : null}
      {canEdit && !blocked ? <Button label={atLimit ? t('collections.charts.limit') : t('collections.charts.new')} onPress={start} saves /> : null}
      {!canEdit ? <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.charts.viewOnly')}</Text> : null}
      {charts.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.charts.empty')}</Text> : null}
      {charts.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={t('collections.charts.open', { name: c.name })}
          onPress={() => router.push(sizeChartHref(c.id) as never)}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
        >
          <Text style={[styles.name, { color: colors.text }]}>{c.name}</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{tCount('collections.charts.sub', c.products, { unit: t(c.unit === 'in' ? 'collections.charts.unitIn' : 'collections.charts.unitCm') })}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  note: { fontSize: 13, lineHeight: 19, padding: 12 },
  card: { minHeight: 64, borderWidth: 1, padding: 14, gap: 2, justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '700' },
})
