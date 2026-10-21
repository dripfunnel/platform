import { StyleSheet, Text, View } from 'react-native'
import { offerKinds, type OfferKind } from '../../../api/offers'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { ChoiceRow } from '../../common/ChoiceRow'

// "What kind of offer?" (OfferEditor's first screen, OFFERS-DESIGN §5 principle 1): four outcomes with an everyday example. Automatic or
// a code is chosen on the next screen.
export function KindPicker({ ship, onPick }: { ship: string; onPick: (kind: OfferKind) => void }) {
  const { colors } = useTheme()
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('offers.editor.pickTitle')}
      </Text>
      <Text style={[styles.sub, { color: colors.muted }]}>{t('offers.editor.pickLede')}</Text>
      {offerKinds.map((kind) => (
        <ChoiceRow key={kind} label={t(`offers.kinds.${kind}`, { ship })} sub={t(`offers.editor.examples.${kind}`, { ship })} selected={false} onPress={() => onPick(kind)} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
