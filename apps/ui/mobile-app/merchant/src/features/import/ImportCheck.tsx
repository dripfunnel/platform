import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { CatalogImport } from '../../api/imports'
import type { Warehouse } from '../../api/inventory'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { ChoiceRow } from '../common/ChoiceRow'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { ProblemRows } from './ProblemRows'
import { ShareProblems } from './ShareProblems'

type Props = {
  job: CatalogImport
  name: string
  readOnly: boolean
  places: Warehouse[]
  onRestart: () => void
  onRun: (matching: 'update' | 'skip', warehouseId: string | null) => Promise<void>
}

/** Check: what's ready, what needs fixing and why, what to do with products already here, and where stock goes (K2–K5). */
export function ImportCheck({ job, name, readOnly, places, onRestart, onRun }: Props) {
  const { colors } = useTheme()
  const [matching, setMatching] = useState<'update' | 'skip'>('update')
  const [place, setPlace] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const chosen = place ?? places.find((warehouse) => warehouse.isDefault)?.id ?? places[0]?.id ?? null
  const withProblems = job.products - job.ready
  const count = matching === 'update' ? job.ready : job.ready - job.matched
  const number = (value: number) => formatNumber(value, locale)

  const run = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      await onRun(matching, chosen)
    } catch (error) {
      setBusy(false)
      setRefusal(errorMessage(error, 'imports'))
    }
  }

  return (
    <View style={styles.stack}>
      <SectionCard title={t('imports.check.ready', { count: number(job.ready) })} sub={job.source === 'shopify' ? name : t('imports.check.fileName', { name, count: tCount('imports.check.rows', job.products) })}>
        <Text style={[styles.note, { color: colors.muted }]}>{t('imports.check.readyNote', { new: number(job.ready - job.matched), matched: number(job.matched) })}</Text>
        {withProblems > 0 ? <Notice kind="error" text={t('imports.check.problemsNote', { count: number(withProblems) })} /> : null}
      </SectionCard>

      <SectionCard title={t('imports.check.existing', { count: number(job.matched) })}>
        {(['update', 'skip'] as const).map((mode) => (
          <ChoiceRow key={mode} label={t(`imports.check.${mode}`)} selected={matching === mode} disabled={busy} onPress={() => setMatching(mode)} />
        ))}
      </SectionCard>

      {places.length > 0 ? (
        <SectionCard title={t('imports.check.stockIn')}>
          {places.map((warehouse) => (
            <ChoiceRow
              key={warehouse.id}
              label={warehouse.isDefault ? t('imports.check.isDefault', { name: warehouse.name }) : warehouse.name}
              selected={warehouse.id === chosen}
              disabled={busy}
              onPress={() => setPlace(warehouse.id)}
            />
          ))}
        </SectionCard>
      ) : null}

      {job.problems.length > 0 ? (
        <SectionCard title={t('imports.check.fix')}>
          <ProblemRows job={job} />
          <ShareProblems csv={job.problemsCsv} />
        </SectionCard>
      ) : null}

      {refusal ? <Notice kind="error" text={refusal} /> : null}
      <Button label={tCount('imports.check.run', count)} onPress={() => void run()} busy={busy} disabled={readOnly || count === 0} saves />
      <Button kind="secondary" label={t('imports.check.restart')} onPress={onRestart} disabled={busy} />
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  note: { fontSize: 13, lineHeight: 19 },
})
