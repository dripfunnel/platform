import { View } from 'react-native'
import { t } from '../../../messages'
import { ChoiceRow } from '../../common/ChoiceRow'
import { SectionCard } from '../../common/SectionCard'
import { productKinds, type ProductKind } from './kindDetails'

type Props = { kind: ProductKind; disabled: boolean; onPick: (kind: ProductKind) => void }

// What is sold (CatEditor "What are you selling?"): a physical item, a download, a service or a gift card. A supplier sells physical items only, so its editor has no card.
export function KindCard({ kind, disabled, onPick }: Props) {
  return (
    <SectionCard title={t('products.kind.title')}>
      <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
        {productKinds.map((option) => (
          <ChoiceRow key={option} label={t(`products.kind.${option}`)} sub={t(`products.kind.${option}Sub`)} selected={kind === option} disabled={disabled} onPress={() => onPick(option)} />
        ))}
      </View>
    </SectionCard>
  )
}
