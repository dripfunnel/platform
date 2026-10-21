import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Notice } from '../../common/Notice'
import { StatusChip } from '../../products/StatusChip'
import { statusTone } from '../offerView'
import type { Outlook } from './summary'

// The summary (OfferEditor's aside, collapsible on a phone): the offer in a sentence always, and under "Show details" what saving will
// do and what to double-check.
export function SummaryCard({ sentence, outlook }: { sentence: string; outlook: Outlook }) {
  const { colors, radii } = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <View style={styles.head}>
        <Text style={[styles.eyebrow, { color: colors.muted }]}>{t('offers.editor.summary')}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.toggle}>
          <Text style={[styles.toggleText, { color: colors.link }]}>{open ? t('offers.editor.hideDetails') : t('offers.editor.showDetails')}</Text>
        </Pressable>
      </View>
      <Text style={[styles.sentence, { color: colors.text }]}>{sentence}</Text>
      {open ? (
        <>
          {outlook.loud ? <Notice text={outlook.loud} /> : null}
          <View style={styles.will}>
            <StatusChip label={t(`offers.status.${outlook.will.key}`)} tone={statusTone[outlook.will.key]} />
            <Text style={[styles.willText, { color: colors.textStrong }]}>{outlook.will.text}</Text>
          </View>
          {outlook.warns.map((warning) => (
            <Notice key={warning} text={warning} />
          ))}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '700' },
  toggle: { minHeight: 44, justifyContent: 'center' },
  toggleText: { fontSize: 13, fontWeight: '700' },
  sentence: { fontSize: 15, lineHeight: 23 },
  will: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  willText: { flex: 1, fontSize: 13, lineHeight: 18 },
})
