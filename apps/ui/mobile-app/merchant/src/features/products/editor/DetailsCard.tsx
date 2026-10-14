import { t } from '../../../messages'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { ChoiceRow } from './ChoiceRow'
import { TextArea } from './TextArea'
import type { Draft } from './draft'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; disabled: boolean; nameMissing: boolean; showVisibility: boolean }

// The name and description (CATALOG-DESIGN.md C1–C2) and whether it shows on the store (C14), which a supplier never sets.
export function DetailsCard({ draft, update, disabled, nameMissing, showVisibility }: Props) {
  return (
    <SectionCard title={t('products.details.title')}>
      <TextField
        label={t('products.details.name')}
        value={draft.name}
        onChangeText={(name) => update((d) => ({ ...d, name }))}
        placeholder={t('products.details.namePlaceholder')}
        autoCapitalize="words"
        editable={!disabled}
        invalid={nameMissing}
        help={nameMissing ? t('products.details.nameMissing') : undefined}
      />
      <TextArea
        label={t('products.details.description')}
        optional={t('products.details.optional')}
        value={draft.description}
        onChangeText={(description) => update((d) => ({ ...d, description }))}
        placeholder={t('products.details.descriptionPlaceholder')}
        editable={!disabled}
      />
      {showVisibility ? (
        <>
          <ChoiceRow label={t('products.visibility.visible')} sub={t('products.visibility.visibleSub')} selected={draft.visible} disabled={disabled} onPress={() => update((d) => ({ ...d, visible: true }))} />
          <ChoiceRow label={t('products.visibility.hidden')} sub={t('products.visibility.hiddenSub')} selected={!draft.visible} disabled={disabled} onPress={() => update((d) => ({ ...d, visible: false }))} />
        </>
      ) : null}
    </SectionCard>
  )
}
