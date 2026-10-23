import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { cancelStore, type StoreDataPart, type StoreSubscription } from '../../../api/settingsStore'
import { formatDay, formatNumber } from '@dripfunnel/mobile-shared/format'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { tCount } from '../../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { shareCsv } from '../../common/shareCsv'
import { SheetConfirm, SheetFrame } from '../../shell/BottomSheet'
import { useFeedback } from '../../shell/Feedback'
import { useStoreDataExport } from './useStoreDataExport'

export type CloseStep = 'consequence' | 'export' | 'confirm' | 'closed'

type Props = { sub: StoreSubscription; storeName: string; client: ApiClient; start: CloseStep; onClosed: (sub: StoreSubscription) => void; onClose: () => void }

const dayOf = (iso: string) => formatDay(iso.slice(0, 10), locale)

// A paid plan sells until its period ends; a trial or a free plan closes at once (SAAS §4.2; the web's CloseDialog).
const sellsOn = (sub: StoreSubscription) => sub.status !== 'trial' && Number(sub.price.amount) > 0

// Close my store as bottom sheets (PortalBilling's flow at phone width): what closing does, the data export, the confirmation, closed.
// Closing is the Owner's call and the API decides it again; a refusal stays in the sheet in words by its code.
export function CloseStoreSheet({ sub, storeName, client, start, onClosed, onClose }: Props) {
  const [step, setStep] = useState<CloseStep>(start)
  const [back, setBack] = useState<CloseStep | null>(null)
  const [closed, setClosed] = useState<StoreSubscription | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const paid = sellsOn(sub)
  const consequence = paid ? t('settings.store.close.paid', { date: dayOf(sub.periodEnd) }) : t('settings.store.close.now')

  const download = (from: CloseStep | null) => {
    setBack(from)
    setStep('export')
  }

  const close = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const after = await cancelStore(client)
      setClosed(after)
      onClosed(after)
      setStep('closed')
    } catch (error) {
      setFailure(errorMessage(error, 'closeStore'))
    } finally {
      setBusy(false)
    }
  }

  if (step === 'export') return <ExportStep client={client} onBack={() => (back === null ? onClose() : setStep(back))} onClose={onClose} />

  if (step === 'closed') {
    const until = closed ? dayOf(closed.cancelAt ?? closed.periodEnd) : ''
    return (
      <SheetFrame onClose={onClose}>
        <Heading text={t('settings.store.close.closedTitle')} />
        <Body text={paid ? t('settings.store.close.closed', { date: until }) : t('settings.store.close.closedNow')} />
        <Body text={t('settings.store.close.download')} />
        <View style={styles.buttons}>
          <Button label={t('settings.store.close.done')} onPress={onClose} />
          <Button kind="secondary" label={t('settings.store.close.downloadData')} onPress={() => download('closed')} />
        </View>
      </SheetFrame>
    )
  }

  if (step === 'confirm') {
    return (
      <SheetFrame onClose={onClose}>
        <Heading text={t('settings.store.close.confirmTitle', { store: storeName })} />
        <Body text={consequence} />
        <Body text={t('settings.store.close.kept')} />
        {failure ? <Notice kind="error" text={failure} /> : null}
        <View style={styles.buttons}>
          <SheetConfirm label={t('settings.store.close.confirm')} danger saves busy={busy} onPress={() => void close()} />
          <Button kind="secondary" label={t('settings.store.close.keep')} onPress={onClose} />
        </View>
      </SheetFrame>
    )
  }

  return (
    <SheetFrame onClose={onClose}>
      <Heading text={t('settings.store.close.sheetTitle')} />
      <Body text={consequence} />
      <Body text={t('settings.store.close.kept')} />
      <Body text={t('settings.store.close.download')} />
      <View style={styles.buttons}>
        <Button label={t('settings.store.close.continue')} onPress={() => setStep('confirm')} />
        <Button kind="secondary" label={t('settings.store.close.downloadFirst')} onPress={() => download('consequence')} />
        <Button kind="secondary" label={t('settings.store.close.keep')} onPress={onClose} />
      </View>
    </SheetFrame>
  )
}

// The three parts of `exportStoreData`, each shared on its own through the system share sheet (decided on #503: CSV text, no file dependency).
function ExportStep({ client, onBack, onClose }: { client: ApiClient; onBack: () => void; onClose: () => void }) {
  const feedback = useFeedback()
  const { parts, error, busy, start } = useStoreDataExport(client)

  useEffect(() => {
    void start()
  }, [start])

  const share = async (part: StoreDataPart) => {
    if (part.job.csv === null) return
    try {
      await shareCsv(t(`settings.store.close.data.kinds.${part.kind}`), part.job.csv)
    } catch {
      feedback.toast({ message: t('settings.store.close.data.shareFailed') })
    }
  }

  const unsettled = !busy && (parts === null || parts.some((part) => part.job.state !== 'ready'))
  return (
    <SheetFrame onClose={onClose}>
      <Heading text={t('settings.store.close.data.title')} />
      {error ? <Notice kind="error" text={errorMessage(error, 'closeStore')} /> : null}
      {busy && !parts ? <Notice text={t('settings.store.close.data.preparing')} /> : null}
      {!busy && !error && parts === null ? <Notice kind="error" text={t('settings.store.close.data.failed')} /> : null}
      {parts?.map((part) => (
        <View key={part.kind} style={styles.part}>
          <Text style={styles.partText}>
            <PartLine part={part} />
          </Text>
          {part.job.state === 'ready' && part.job.csv ? <Button kind="secondary" label={t('settings.store.close.data.share', { kind: t(`settings.store.close.data.kinds.${part.kind}`) })} onPress={() => void share(part)} /> : null}
        </View>
      ))}
      <View style={styles.buttons}>
        {unsettled ? <Button kind="secondary" saves label={t('settings.store.close.data.again')} onPress={() => void start()} /> : null}
        <Button kind="secondary" label={t('settings.store.close.data.back')} onPress={onBack} />
      </View>
    </SheetFrame>
  )
}

function PartLine({ part }: { part: StoreDataPart }) {
  const { colors } = useTheme()
  const { job } = part
  const words = {
    preparing: t('settings.store.close.data.waiting'),
    failed: t('settings.store.close.data.failed'),
    tooLarge: t('settings.store.close.data.failed'),
    expired: t('settings.store.close.data.expired'),
    ready: job.truncated ? t('settings.store.close.data.truncated', { count: formatNumber(job.entries ?? 0, locale) }) : tCount('settings.store.close.data.rows', job.entries ?? 0, { count: formatNumber(job.entries ?? 0, locale) }),
  }[job.state]
  const bad = job.state === 'failed' || job.state === 'tooLarge'
  return (
    <>
      <Text style={styles.kind}>{t(`settings.store.close.data.kinds.${part.kind}`)}</Text>
      <Text style={{ color: bad ? colors.danger : colors.textStrong }}> · {words}</Text>
    </>
  )
}

function Heading({ text }: { text: string }) {
  const { colors } = useTheme()
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
      {text}
    </Text>
  )
}

function Body({ text }: { text: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.body, { color: colors.textStrong }]}>{text}</Text>
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
  buttons: { gap: 8, paddingTop: 4 },
  part: { gap: 8 },
  partText: { fontSize: 14, lineHeight: 20 },
  kind: { fontWeight: '700' },
})
