import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadCatalogExport, loadCatalogExports, requestCatalogExport, type CatalogExport, type ExportKind } from '../../api/imports'
import { formatDateTime, formatNumber } from '@dripfunnel/mobile-shared/format'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { shareCsv } from '../common/shareCsv'
import { useExportJob } from '../common/useExportJob'

const kinds: readonly ExportKind[] = ['products', 'stock']

/** Export (K8): products or stock as a job, shared through the system sheet once ready (decided on #503), and the caller's recent files to share again. */
export function ExportCard({ client }: { client: ApiClient }) {
  const { colors } = useTheme()
  const [recent, setRecent] = useState<CatalogExport[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const live = useRef(true)

  const refresh = useCallback(
    () =>
      loadCatalogExports(client).then(
        (found) => live.current && setRecent(found),
        () => live.current && setProblem(t('imports.export.loadFailed')),
      ),
    [client],
  )

  useEffect(() => {
    live.current = true
    void refresh()
    return () => {
      live.current = false
    }
  }, [refresh])

  const share = useCallback(async (kind: ExportKind, csv: string | null) => {
    if (csv === null) return
    setProblem(null)
    try {
      await shareCsv(t(`imports.export.label.${kind}`), csv)
    } catch {
      setProblem(t('imports.export.shareFailed'))
    }
  }, [])

  const products = useExportJob({ request: () => requestCatalogExport(client, 'products'), read: (id) => loadCatalogExport(client, id), onReady: (job) => void share('products', job.csv).then(refresh) })
  const stock = useExportJob({ request: () => requestCatalogExport(client, 'stock'), read: (id) => loadCatalogExport(client, id), onReady: (job) => void share('stock', job.csv).then(refresh) })
  const running = { products, stock }
  const busy = products.busy || stock.busy
  const failure = [products, stock].find((one) => one.error !== null || one.job?.state === 'failed' || one.job?.state === 'tooLarge')

  return (
    <SectionCard title={t('imports.export.title')} sub={t('imports.export.lede')}>
      {kinds.map((kind) => (
        <Button key={kind} kind="secondary" label={t(`imports.export.${kind}`)} onPress={() => void running[kind].start()} busy={running[kind].busy} disabled={busy} />
      ))}
      {busy ? <Notice text={t('imports.export.preparing')} /> : null}
      {failure ? <Notice kind="error" text={failure.error !== null ? errorMessage(failure.error, 'imports') : t('imports.export.failedNote')} /> : null}
      {problem ? <Notice kind="error" text={problem} /> : null}
      {recent.map((found) => (
        <View key={found.id} style={[styles.row, { borderColor: colors.border }]}>
          <View style={styles.rowText}>
            <Text style={[styles.label, { color: colors.text }]}>
              {t('imports.export.row', { label: t(`imports.export.label.${found.kind}`), count: found.entries === null ? t('imports.export.counting') : tCount('imports.export.count', found.entries) })}
            </Text>
            <Text style={[styles.when, { color: colors.muted }]}>{formatDateTime(found.requestedAt, locale, 'UTC')}</Text>
            {found.truncated && found.entries !== null ? <Text style={[styles.when, { color: colors.warning }]}>{t('imports.export.truncated', { count: formatNumber(found.entries, locale) })}</Text> : null}
          </View>
          {found.state === 'ready' ? (
            <View style={styles.action}>
              <Button kind="secondary" label={t('imports.export.share')} onPress={() => void share(found.kind, found.csv)} />
            </View>
          ) : found.state === 'preparing' ? null : (
            <Text style={[styles.state, { color: colors.muted }]}>{found.state === 'expired' ? t('imports.export.expired') : found.state === 'tooLarge' ? t('imports.export.tooLarge') : t('imports.export.failed')}</Text>
          )}
        </View>
      ))}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1 },
  rowText: { flex: 1, gap: 2 },
  label: { fontSize: 14, fontWeight: '700' },
  when: { fontSize: 12 },
  action: { width: 110 },
  state: { fontSize: 13 },
})
