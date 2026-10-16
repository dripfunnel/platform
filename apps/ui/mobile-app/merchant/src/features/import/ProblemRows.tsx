import { StyleSheet, Text, View } from 'react-native'
import type { CatalogImport } from '../../api/imports'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'

/** The first problems the API lists, each by row and column in its own words, and how many more are in the file (K3). */
export function ProblemRows({ job }: { job: Pick<CatalogImport, 'problems' | 'problemCount'> }) {
  const { colors } = useTheme()
  const more = job.problemCount - job.problems.length
  return (
    <>
      {job.problems.map((problem) => (
        <View key={`${problem.line}-${problem.column ?? ''}-${problem.code}`} style={styles.problem}>
          <Text style={[styles.where, { color: colors.muted }]}>{`${t('imports.check.row', { line: problem.line })} · ${problem.column ?? t('imports.check.file')}`}</Text>
          <Text style={[styles.message, { color: colors.text }]}>{problem.message}</Text>
        </View>
      ))}
      {more > 0 ? <Text style={[styles.note, { color: colors.muted }]}>{tCount('imports.check.moreProblems', more)}</Text> : null}
    </>
  )
}

const styles = StyleSheet.create({
  problem: { gap: 2 },
  where: { fontSize: 12, fontFamily: 'monospace' },
  message: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 13, lineHeight: 19 },
})
