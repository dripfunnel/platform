import { t } from '../../../messages'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { Hint, type SectionProps } from './parts'

// "With other offers" (OFFERS-DESIGN M): which kinds of offer this one may share a cart with. A new offer combines with nothing.
export function CombinesSection({ draft: d, set, region, disabled }: SectionProps) {
  return (
    <SectionCard title={t('offers.editor.sections.others')} sub={t('offers.editor.combinesTitle')}>
      <Hint text={t('offers.editor.combinesHelp')} />
      {(['product', 'order', 'shipping'] as const).map((kind) => (
        <Switch key={kind} label={t(`offers.editor.combines.${kind}`, { ship: region.ship })} value={d.combines[kind]} disabled={disabled} onChange={(on) => set({ combines: { ...d.combines, [kind]: on } })} />
      ))}
    </SectionCard>
  )
}
