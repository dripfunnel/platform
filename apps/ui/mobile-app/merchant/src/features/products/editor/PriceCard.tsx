import { View } from 'react-native'
import { moneyDigits } from '@dripfunnel/mobile-shared/format'
import { t } from '../../../messages'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import type { Draft, DraftProblem } from './draft'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; currency: string; disabled: boolean; problems: readonly DraftProblem[] }

export const exampleOf = (currency: string): string => (moneyDigits(currency) === 0 ? '499' : `499.${'0'.repeat(moneyDigits(currency))}`)

// The price of a product without choices (CATALOG-DESIGN.md C4): what the shopper pays, a compare-at price, and what it costs the
// seller. Typed in major units of the store's currency; the amounts that go to the API are minor units (draft.ts).
export function PriceCard({ draft, update, currency, disabled, problems }: Props) {
  const only = draft.versions.find((version) => !version.removed)
  if (!only) return null
  const change = (patch: Partial<Pick<typeof only, 'price' | 'compareAt' | 'cost'>>) =>
    update((d) => {
      const at = d.versions.findIndex((version) => !version.removed)
      return { ...d, versions: d.versions.map((version, i) => (i === at ? { ...version, ...patch } : version)) }
    })
  const example = exampleOf(currency)
  return (
    <SectionCard title={t('products.price.title')} sub={currency}>
      <View style={{ gap: 14 }}>
        <TextField
          label={t('products.price.price')}
          value={only.price}
          onChangeText={(price) => change({ price })}
          keyboardType="decimal-pad"
          placeholder={example}
          editable={!disabled}
          invalid={problems.includes('price')}
          help={problems.includes('price') ? t('products.price.invalid', { example }) : t('products.price.none')}
        />
        <TextField
          label={`${t('products.price.compare')} (${t('products.price.optional')})`}
          value={only.compareAt}
          onChangeText={(compareAt) => change({ compareAt })}
          keyboardType="decimal-pad"
          editable={!disabled}
          invalid={problems.includes('compare')}
          help={problems.includes('compare') ? t('products.price.compareLow') : t('products.price.compareHelp')}
        />
        <TextField
          label={`${t('products.price.cost')} ${t('products.price.costHint')}`}
          value={only.cost}
          onChangeText={(cost) => change({ cost })}
          keyboardType="decimal-pad"
          placeholder={t('products.price.costPlaceholder')}
          editable={!disabled}
          invalid={problems.includes('cost')}
          help={problems.includes('cost') ? t('products.price.invalid', { example }) : undefined}
        />
      </View>
    </SectionCard>
  )
}
