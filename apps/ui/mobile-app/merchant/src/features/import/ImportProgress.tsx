import { StyleSheet, Text, View } from 'react-native'
import type { CatalogImport } from '../../api/imports'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { useOnline } from '@dripfunnel/mobile-shared/connection'
import { ProblemRows } from './ProblemRows'
import { ShareProblems } from './ShareProblems'

const number = (value: number) => formatNumber(value, locale)

type RunningProps = { run: CatalogImport; onLeave: () => void }

/** Import: the products done of those going in; leaving is fine, and offline it says it's paused, nothing half-saved. */
export function ImportRunning({ run, onLeave }: RunningProps) {
  const { colors } = useTheme()
  const online = useOnline()
  const total = run.ready
  const done = Math.min(run.done, total)
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <SectionCard title={tCount('imports.running.title', total)} sub={t('imports.running.progress', { done: number(done), total: number(total) })}>
      <View accessibilityRole="progressbar" accessibilityLabel={t('imports.running.progressLabel')} accessibilityValue={{ min: 0, max: total, now: done }} style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.brand }]} />
      </View>
      {online ? null : <Notice text={t('imports.running.paused')} />}
      <Button kind="secondary" label={t('imports.running.leave')} onPress={onLeave} />
    </SectionCard>
  )
}

type DoneProps = { run: CatalogImport; onRestart: () => void; onView: () => void }

/** Done: what went in, what was skipped or couldn't be saved, photos still on their way, and the file of what didn't. */
export function ImportDone({ run, onRestart, onView }: DoneProps) {
  const { colors } = useTheme()
  const skipped = run.products - run.ready
  const lines = [
    skipped > 0 && tCount('imports.done.skipped', skipped),
    run.failed > 0 && tCount('imports.done.failed', run.failed),
    run.photosPending > 0 && tCount('imports.done.photos', run.photosPending),
  ].filter((line): line is string => typeof line === 'string')
  return (
    <SectionCard title={t('imports.done.title', { added: number(run.created), updated: number(run.updated) })} sub={lines.length > 0 ? lines.join(' ') : undefined}>
      {run.problems.length > 0 ? (
        <View style={styles.problems}>
          <Text accessibilityRole="header" style={[styles.head, { color: colors.heading }]}>
            {t('imports.done.problemsHead')}
          </Text>
          <ProblemRows job={run} />
        </View>
      ) : null}
      <ShareProblems csv={run.problemsCsv} />
      <Button label={t('imports.done.view')} onPress={onView} />
      <Button kind="secondary" label={t('imports.done.another')} onPress={onRestart} />
    </SectionCard>
  )
}

/** A run the server ended (a lost Shopify connection): nothing more changed, and the reason as the API gives it for the run as a whole. */
export function ImportStopped({ run, onRestart }: { run: CatalogImport; onRestart: () => void }) {
  return (
    <SectionCard title={t('imports.stopped.title')} sub={run.problems.find((problem) => problem.line === 0)?.message ?? t('imports.stopped.body')}>
      <Button label={t('imports.stopped.retry')} onPress={onRestart} />
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  problems: { gap: 10 },
  head: { fontSize: 15, fontWeight: '800' },
})
