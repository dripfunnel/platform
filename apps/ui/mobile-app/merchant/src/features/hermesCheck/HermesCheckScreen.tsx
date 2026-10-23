import { useEffect, useMemo } from 'react'
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { polyfilledIntl } from '@dripfunnel/mobile-shared/intl'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { engineName, reportOf, runChecks } from './runChecks'

// REACT-NATIVE.md §6: the format inputs run on this phone's engine and compared with the expected strings.
// Open it in a development build at /hermes-check.
export function HermesCheckScreen() {
  const { colors } = useTheme()
  const installed = useMemo(polyfilledIntl, [])
  const results = useMemo(() => runChecks(locale), [])
  const report = useMemo(() => reportOf(results, { engine: engineName(), platform: Platform.OS, installed }), [results, installed])
  useEffect(() => {
    console.log(report)
  }, [report])

  const passed = results.filter((r) => r.passed).length
  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.heading }]}>{t('hermesCheck.title')}</Text>
      <Text style={{ color: colors.text }}>{t('hermesCheck.engine', { engine: engineName(), platform: Platform.OS })}</Text>
      <Text style={{ color: colors.text }}>{t('hermesCheck.installed', { list: installed.join(', ') || t('hermesCheck.none') })}</Text>
      <Text style={[styles.summary, { color: passed === results.length ? colors.success : colors.danger }]}>{t('hermesCheck.summary', { passed, total: results.length })}</Text>
      {results.map((r) => (
        <View key={`${r.group}/${r.name}`} style={[styles.row, { borderColor: colors.border, backgroundColor: r.passed ? colors.surface : colors.dangerSurface }]}>
          <Text style={{ color: colors.text }}>{`${r.group} / ${r.name}: ${r.passed ? t('hermesCheck.pass') : t('hermesCheck.fail')}`}</Text>
          {r.passed ? null : <Text style={{ color: colors.danger }}>{`${t('hermesCheck.expected')} ${JSON.stringify(r.expected)}\n${t('hermesCheck.actual')} ${JSON.stringify(r.actual)}`}</Text>}
        </View>
      ))}
      <Text style={[styles.title, { color: colors.heading }]}>{t('hermesCheck.report')}</Text>
      <Text selectable style={[styles.report, { color: colors.text }]}>
        {report}
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8 },
  title: { fontSize: 20, fontWeight: '700', marginTop: 8 },
  summary: { fontSize: 16, fontWeight: '700' },
  row: { borderWidth: 1, borderRadius: 8, padding: 8, gap: 4 },
  report: { fontFamily: 'monospace', fontSize: 11 },
})
