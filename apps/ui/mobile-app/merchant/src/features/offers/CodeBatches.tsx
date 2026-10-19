import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { codeBatchLimits, codeLengths, codePrefixPattern, generateCodes, loadCodeBatches, loadCodesExport, requestCodesExport, type CodeBatch } from '../../api/offers'
import type { ApiClient } from '../../graphql'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Chip } from '../common/Chip'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { shareCsv } from '../common/shareCsv'
import { TextField } from '../common/TextField'
import { useExportJob } from '../common/useExportJob'
import { offerRefusal } from './offerRefusal'

type Props = { client: ApiClient; offerId: string; canEdit: boolean; canExport: boolean }

type Batches = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; batches: CodeBatch[]; next: string | null; more: 'idle' | 'loading' | 'failed' }

const fileName = (batch: CodeBatch): string => t('offers.codes.file', { name: (batch.prefix || 'codes').toLowerCase().replace(/[^a-z0-9]+/g, '') })

// One run's file: a job asked for, read back until the API has made it, then the system share sheet with the CSV as text (decided on #503).
function BatchFile({ client, batch }: { client: ApiClient; batch: CodeBatch }) {
  const [shared, setShared] = useState(false)
  const exported = useExportJob({
    request: () => requestCodesExport(client, batch.id),
    read: (id) => loadCodesExport(client, id),
    onReady: (job) => {
      if (job.csv !== null) void shareCsv(fileName(batch), job.csv).then(setShared, () => setShared(false))
    },
  })
  const failed = exported.job?.state === 'failed' || exported.job?.state === 'expired' || exported.job?.state === 'tooLarge'
  return (
    <View style={styles.file}>
      <Button saves kind="secondary" label={exported.busy ? t('offers.codes.preparing') : t('offers.codes.makeFile')} busy={exported.busy} onPress={() => void exported.start()} />
      {exported.error !== null ? <Notice kind="error" text={offerRefusal(exported.error)} /> : null}
      {failed ? <Notice kind="error" text={exported.job?.state === 'expired' ? t('offers.codes.expired') : t('offers.codes.fileFailed')} /> : null}
      {exported.job?.state === 'ready' && exported.job.csv !== null ? (
        <>
          <Notice kind="success" text={tCount('offers.codes.ready', exported.job.entries ?? 0)} />
          {!shared ? <Button kind="secondary" label={t('offers.codes.share')} onPress={() => void shareCsv(fileName(batch), exported.job?.csv ?? '').then(setShared)} /> : null}
        </>
      ) : null}
    </View>
  )
}

// Single-use codes (OFFERS-DESIGN H4): an offer's runs of codes, each with its used and unused and its file, and making another run.
export function CodeBatches({ client, offerId, canEdit, canExport }: Props) {
  const { colors } = useTheme()
  const [view, setView] = useState<Batches>({ kind: 'loading' })
  const [count, setCount] = useState('500')
  const [prefix, setPrefix] = useState('')
  const [length, setLength] = useState<number>(codeLengths[1])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    setView({ kind: 'loading' })
    loadCodeBatches(client, offerId).then(
      (page) => mine === latest.current && setView({ kind: 'ready', batches: page.rows, next: page.next, more: 'idle' }),
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [client, offerId])
  useEffect(load, [load])

  const more = () => {
    if (view.kind !== 'ready' || !view.next) return
    const mine = latest.current
    const shown = view
    setView({ ...shown, more: 'loading' })
    loadCodeBatches(client, offerId, shown.next).then(
      (page) => mine === latest.current && setView({ kind: 'ready', batches: [...shown.batches, ...page.rows], next: page.next, more: 'idle' }),
      () => mine === latest.current && setView({ ...shown, more: 'failed' }),
    )
  }

  const n = Number(count)
  const countOk = /^\d+$/.test(count) && n >= 1 && n <= codeBatchLimits.count
  const cleanPrefix = prefix.trim().toUpperCase()
  const prefixOk = codePrefixPattern.test(cleanPrefix)
  const make = () => {
    setProblem(null)
    setMade(null)
    if (!countOk) return setProblem(t('offers.codes.countError', { max: formatNumber(codeBatchLimits.count, locale) }))
    if (!prefixOk) return setProblem(t('offers.codes.prefixError', { max: String(codeBatchLimits.prefix) }))
    setBusy(true)
    generateCodes(client, offerId, { count: n, prefix: cleanPrefix, length })
      .then(
        (batch) => {
          setMade(tCount('offers.codes.made', batch.count))
          load()
        },
        (error: unknown) => setProblem(offerRefusal(error)),
      )
      .finally(() => setBusy(false))
  }

  const sample = Array.from({ length: 3 }, (_, i) => `${cleanPrefix}${t('offers.codes.sampleChars').slice(i * 2, i * 2 + length)}`).join(t('offers.codes.sampleJoiner'))
  return (
    <SectionCard title={t('offers.codes.title')}>
      {view.kind === 'loading' ? <ActivityIndicator color={colors.muted} /> : null}
      {view.kind === 'error' ? (
        <>
          <Notice kind="error" text={t('offers.codes.error')} />
          <Button kind="secondary" label={t('common.tryAgain')} onPress={load} />
        </>
      ) : null}
      {view.kind === 'ready' && view.batches.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('offers.codes.none')}</Text> : null}
      {view.kind === 'ready'
        ? view.batches.map((batch) => (
            <View key={batch.id} style={[styles.batch, { borderColor: colors.border }]}>
              <Text style={[styles.sub, { color: colors.text }]}>
                {t('offers.codes.batch', { count: formatNumber(batch.count, locale), used: formatNumber(batch.used, locale), unused: formatNumber(batch.count - batch.used, locale), prefix: batch.prefix || t('offers.codes.noPrefix') })}
              </Text>
              {canExport ? <BatchFile client={client} batch={batch} /> : null}
            </View>
          ))
        : null}
      {view.kind === 'ready' && view.next ? (
        <>
          <Button kind="secondary" label={view.more === 'loading' ? t('offers.codes.loadingMore') : t('offers.codes.more')} busy={view.more === 'loading'} onPress={more} />
          {view.more === 'failed' ? <Notice kind="error" text={t('offers.codes.moreFailed')} /> : null}
        </>
      ) : null}
      {canEdit ? (
        <View style={styles.make}>
          <TextField label={t('offers.codes.count')} value={count} onChangeText={(text) => setCount(text.replace(/\D/g, ''))} keyboardType="number-pad" invalid={!countOk} />
          <TextField label={t('offers.codes.prefix')} value={prefix} onChangeText={(text) => setPrefix(text.toUpperCase().replace(/\s/g, ''))} maxLength={codeBatchLimits.prefix} autoCapitalize="characters" invalid={!prefixOk} />
          <Text style={[styles.label, { color: colors.text }]}>{t('offers.codes.length')}</Text>
          <View style={styles.chips}>
            {codeLengths.map((option) => (
              <Chip key={option} label={String(option)} selected={option === length} onPress={() => setLength(option)} />
            ))}
          </View>
          <Text style={[styles.sub, { color: colors.muted }]}>{t('offers.codes.sample', { codes: sample })}</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{t('offers.codes.help')}</Text>
          <Button saves kind="secondary" label={busy ? t('offers.codes.making') : t('offers.codes.make')} busy={busy} onPress={make} />
          {problem ? <Notice kind="error" text={problem} /> : null}
          {made ? <Notice kind="success" text={made} /> : null}
        </View>
      ) : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  sub: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 14, fontWeight: '700' },
  batch: { borderTopWidth: 1, paddingTop: 12, gap: 8 },
  file: { gap: 8 },
  make: { gap: 12 },
  chips: { flexDirection: 'row', gap: 6 },
})
