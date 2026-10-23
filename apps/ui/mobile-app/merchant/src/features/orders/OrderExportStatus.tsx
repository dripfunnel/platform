import { StyleSheet, Text, View } from 'react-native'
import type { ExportJob } from '../../api/exportJob'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'

type Props = { job: ExportJob; onShare: () => void }

// The export's state in words under the Export button (FIRST-RELEASE.md §13); a ready one can be shared again from here.
export function OrderExportStatus({ job, onShare }: Props) {
  const { colors } = useTheme()
  const words = {
    preparing: t('orders.export.preparing'),
    ready: job.truncated ? t('orders.export.truncated', { count: formatNumber(job.entries ?? 0, locale) }) : tCount('orders.export.ready', job.entries ?? 0, { count: formatNumber(job.entries ?? 0, locale) }),
    expired: t('orders.export.expired'),
    tooLarge: t('orders.export.tooLarge'),
    failed: t('orders.export.failed'),
  }[job.state]
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.box}>
      <Text style={[styles.text, { color: job.state === 'failed' || job.state === 'tooLarge' ? colors.danger : colors.textStrong }]}>{words}</Text>
      {job.state === 'ready' && job.csv ? <Button kind="secondary" label={t('orders.export.share')} onPress={onShare} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  text: { fontSize: 14, lineHeight: 20 },
})
