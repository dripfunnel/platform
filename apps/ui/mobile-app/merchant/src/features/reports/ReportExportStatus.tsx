import { StyleSheet, Text, View } from 'react-native'
import type { ExportJob } from '../../api/exportJob'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'

type Props = { job: ExportJob; onShare: () => void }

// The export's state in words under the buttons; a ready one can be shared again from here.
export function ReportExportStatus({ job, onShare }: Props) {
  const { colors } = useTheme()
  const rows = job.entries ?? 0
  const words = {
    preparing: t('reports.export.preparing'),
    ready: job.truncated ? t('reports.export.truncated', { count: formatNumber(rows, locale) }) : tCount('reports.export.ready', rows),
    expired: t('reports.export.expired'),
    tooLarge: t('reports.export.tooLarge'),
    failed: t('reports.export.failed'),
  }[job.state]
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.box}>
      <Text style={[styles.text, { color: job.state === 'failed' || job.state === 'tooLarge' ? colors.danger : colors.textStrong }]}>{words}</Text>
      {job.state === 'ready' && job.csv ? <Button kind="secondary" label={t('reports.export.share')} onPress={onShare} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  text: { fontSize: 14, lineHeight: 20 },
})
