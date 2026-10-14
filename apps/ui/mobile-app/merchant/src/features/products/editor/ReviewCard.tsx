import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { SectionCard } from '../../common/SectionCard'

type Props = { supplier: string | null; onApprove: () => void; onSendBack: () => void }

// A supplier's product waiting for the merchant (CATALOG-DESIGN.md L3, L5): approve it, or send it back with a reason the
// supplier sees. The merchant sets the price and can change it after approving, or edit below first.
export function ReviewCard({ supplier, onApprove, onSendBack }: Props) {
  const { colors } = useTheme()
  return (
    <SectionCard title={t('products.review.title', { supplier: supplier ?? t('products.review.theSupplier') })}>
      <Text style={[styles.note, { color: colors.muted }]}>{t('products.review.note')}</Text>
      <View style={styles.buttons}>
        <Button label={t('products.review.approve')} onPress={onApprove} saves />
        <Button kind="secondary" label={t('products.review.sendBack')} onPress={onSendBack} saves />
      </View>
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  note: { fontSize: 13, lineHeight: 19 },
  buttons: { gap: 8 },
})
