import { StyleSheet, Text } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { SectionCard } from '../../common/SectionCard'

type Props = { availability: 'on' | 'plan'; productId: string | null; dirty: boolean; onOpen: () => void }

// A+ content opens its own screen (CatAPlus, CATALOG-DESIGN.md Q). A product is saved first, and a plan without it says so, with
// no way to buy it here: plans and billing are not in the app (DESIGN.md §5).
export function AplusCard({ availability, productId, dirty, onOpen }: Props) {
  const { colors } = useTheme()
  return (
    <SectionCard title={t('products.aplus.title')} sub={t('products.aplus.summary')}>
      {availability === 'plan' ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.aplus.plan')}</Text> : null}
      {availability === 'on' && !productId ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.aplus.saveFirst')}</Text> : null}
      {availability === 'on' && productId && dirty ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.aplus.saveChangesFirst')}</Text> : null}
      {availability === 'on' && productId && !dirty ? <Button kind="secondary" label={t('products.aplus.open')} onPress={onOpen} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  note: { fontSize: 14, lineHeight: 20 },
})
