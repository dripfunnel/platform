import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { deleteSizeChart, saveSizeChart } from '../../api/sizeCharts'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Chip } from '../common/Chip'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { TextField } from '../common/TextField'
import { SaveBar } from '../products/editor/SaveBar'
import { TextArea } from '../products/editor/TextArea'
import { useFeedback } from '../shell/Feedback'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { collectionsAccess } from './access'
import { ChartGrid } from './ChartGrid'
import { sizeChartHref } from './routes'
import type { SizeChartEditorData } from './SizeChartEditorScreen'
import { chartInput, chartProblem, draftOfChart, inUnit, isChartDirty, noValue, withMeasurement, withRow, withSystems, type ChartDraft } from './sizeChartDraft'
import { useLeaveGuard } from './useLeaveGuard'

type Props = { client: ApiClient; data: SizeChartEditorData }

// CatSizeCharts' editor at phone width: the grid, its units, a note, and the shopper's view of it. Saving a chart used on several
// products asks whether to change all of them or make a copy (CATALOG-DESIGN.md R9); deleting says how many lose it (R10).
export function SizeChartForm({ client, data }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const feedback = useFeedback()
  const { state } = useShell()
  const { canEdit } = collectionsAccess(data.access, state?.readOnly === true)
  const products = data.chart.products

  const [saved, setSaved] = useState<ChartDraft>(() => draftOfChart(data.chart))
  const [draft, setDraft] = useState(saved)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const dirty = isChartDirty(draft, saved)
  const guard = useLeaveGuard(dirty && !busy)
  const problem = chartProblem(draft)
  const disabled = !canEdit || busy
  const atLimit = data.own >= data.limit
  const columns = [...draft.systems, ...draft.measurements]
  const name = draft.name.trim() || t('collections.charts.title')

  const commit = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const done = await saveSizeChart(client, draft.id, draft.revision, chartInput(draft))
      const next = { ...draft, revision: done.revision }
      setSaved(next)
      setDraft(next)
      feedback.toast({ message: products > 0 ? tCount('collections.charts.savedOn', products, { name }) : t('collections.charts.saved', { name }) })
    } catch (error) {
      setFailure(errorMessage(error, 'sizeCharts'))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (atLimit) return feedback.toast({ message: t('collections.charts.atLimit') })
    setBusy(true)
    try {
      const made = await saveSizeChart(client, null, null, { ...chartInput(draft), name: t('collections.charts.copySuffix', { name }).slice(0, 80) })
      feedback.toast({ message: t('collections.charts.copied') })
      guard.go(() => router.replace(sizeChartHref(made.id) as never))
    } catch (error) {
      feedback.toast({ message: errorMessage(error, 'sizeCharts') })
      setBusy(false)
    }
  }

  const save = () => {
    if (problem) return setTried(true)
    if (products <= 1) return void commit()
    feedback.sheet({
      title: t('collections.charts.changeAllTitle', { count: products }),
      body: t('collections.charts.changeAllBody'),
      choices: [
        { value: 'all', label: t('collections.charts.changeAll', { count: products }) },
        { value: 'copy', label: t('collections.charts.copyInstead') },
      ],
      confirm: t('collections.charts.next'),
      saves: true,
      onConfirm: ({ choice }) => (choice === 'copy' ? copy() : commit()),
    })
  }

  const remove = () =>
    feedback.sheet({
      title: t('collections.charts.deleteTitle', { name }),
      body: products === 0 ? t('collections.charts.deleteNone') : tCount('collections.charts.deleteBody', products),
      confirm: t('collections.charts.deleteConfirm'),
      danger: true,
      saves: true,
      onConfirm: async () => {
        if (!draft.id) return
        try {
          await deleteSizeChart(client, draft.id)
          feedback.toast({ message: t('collections.charts.deleted') })
          guard.finish()
        } catch (error) {
          setFailure(errorMessage(error, 'sizeCharts'))
        }
      },
    })

  const switchUnit = (unit: 'cm' | 'in') => {
    if (unit === draft.unit) return
    setDraft(inUnit(draft, unit))
    feedback.toast({ message: t(unit === 'in' ? 'collections.charts.converted.in' : 'collections.charts.converted.cm') })
  }

  const addSystems = () => {
    const next = withSystems(draft, [t('collections.charts.systems.us'), t('collections.charts.systems.uk'), t('collections.charts.systems.eu')])
    if (!next) return feedback.toast({ message: t('collections.charts.systemsThere') })
    setDraft(next)
    feedback.toast({ message: t('collections.charts.systemsAdded') })
  }

  return (
    <View style={styles.root}>
      <ShellScreen label={t('collections.charts.title')}>
        <View style={styles.content}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.heading }]}>
            {name}
          </Text>
          {!canEdit ? <Notice kind="info" text={t('collections.charts.viewOnly')} /> : null}
          {products > 1 ? <Notice kind="info" text={t('collections.charts.usedMany', { count: products })} /> : null}
          {failure ? <Notice kind="error" text={failure} /> : null}
          <TextField label={t('collections.charts.name')} value={draft.name} onChangeText={(text) => setDraft({ ...draft, name: text })} maxLength={80} editable={!disabled} autoCapitalize="sentences" invalid={tried && problem === 'name'} help={tried && problem === 'name' ? t('collections.charts.problems.name') : undefined} />
          <View accessibilityRole="radiogroup" accessibilityLabel={t('collections.charts.units')} style={styles.wrap}>
            <Chip label={t('collections.charts.unitCm')} selected={draft.unit === 'cm'} disabled={disabled} onPress={() => switchUnit('cm')} />
            <Chip label={t('collections.charts.unitIn')} selected={draft.unit === 'in'} disabled={disabled} onPress={() => switchUnit('in')} />
          </View>
          <ChartGrid draft={draft} onChange={setDraft} disabled={disabled} canEdit={canEdit} invalid={{ columns: tried && problem === 'columns', duplicate: tried && problem === 'duplicate', sizes: tried && problem === 'sizes' }} />
          {canEdit ? (
            <View style={styles.wrap}>
              <Chip dashed label={t('collections.charts.addSize')} disabled={busy} onPress={() => setDraft(withRow(draft))} />
              <Chip dashed label={t('collections.charts.addMeasurement')} disabled={busy} onPress={() => setDraft(withMeasurement(draft, t('collections.charts.measurement')))} />
              <Chip dashed label={t('collections.charts.addSystems')} disabled={busy} onPress={addSystems} />
            </View>
          ) : null}
          {canEdit ? <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.charts.ranges')}</Text> : null}
          {tried && problem && problem !== 'name' ? <Notice kind="error" text={t(`collections.charts.problems.${problem}`)} /> : null}
          <TextArea label={t('collections.charts.fitNote')} value={draft.fitNotes} onChangeText={(text) => setDraft({ ...draft, fitNotes: text })} placeholder={t('collections.charts.fitPlaceholder')} editable={!disabled} lines={2} />
          <Text style={[styles.sub, { color: colors.muted }]}>{tCount('collections.charts.used', products)}</Text>
          <Button kind="secondary" label={t(preview ? 'collections.charts.hideShopperView' : 'collections.charts.shopperView')} onPress={() => setPreview(!preview)} />
          {preview ? (
            <SectionCard title={t('collections.charts.previewTitle', { name })} sub={t('collections.charts.previewSwitch', { unit: t(draft.unit === 'in' ? 'collections.charts.unitIn' : 'collections.charts.unitCm'), other: t(draft.unit === 'cm' ? 'collections.charts.unitIn' : 'collections.charts.unitCm') })}>
              <View accessibilityLabel={t('collections.charts.previewTitle', { name })}>
                <PreviewRow cells={[t('collections.charts.sizeHead'), ...columns]} head />
                {draft.rows.map((r, i) => (
                  <PreviewRow key={i} cells={[r.size || noValue, ...r.values.map((v) => v || noValue)]} />
                ))}
              </View>
              {draft.fitNotes ? <Text style={[styles.sub, { color: colors.textStrong }]}>{draft.fitNotes}</Text> : null}
            </SectionCard>
          ) : null}
          {canEdit ? (
            <>
              <Button kind="secondary" label={t('collections.charts.copy')} onPress={() => void copy()} disabled={busy || data.blocked} saves />
              <Button kind="secondary" label={t('collections.charts.delete')} onPress={remove} disabled={busy} saves />
            </>
          ) : null}
        </View>
      </ShellScreen>
      {canEdit && (dirty || failure !== null) ? <SaveBar failed={failure !== null} label={busy ? t('collections.charts.saving') : t('collections.charts.save')} busy={busy} onDiscard={() => setDraft(saved)} onSave={save} /> : null}
    </View>
  )
}

function PreviewRow({ cells, head = false }: { cells: readonly string[]; head?: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.previewRow, { borderColor: colors.border, backgroundColor: head ? colors.page : colors.surface }]}>
      {cells.map((cell, i) => (
        <Text key={i} style={[styles.previewCell, { color: colors.text, fontWeight: head || i === 0 ? '700' : '400' }]}>
          {cell}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  heading: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  previewRow: { flexDirection: 'row', borderBottomWidth: 1 },
  previewCell: { flex: 1, fontSize: 12, paddingVertical: 8, paddingHorizontal: 6 },
})
