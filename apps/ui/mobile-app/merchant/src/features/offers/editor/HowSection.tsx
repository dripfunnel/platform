import { StyleSheet, View } from 'react-native'
import { codeLengths } from '../../../api/offers'
import { t } from '../../../messages'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { ChoiceRow } from '../../common/ChoiceRow'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { generateCode, offerLimits, type OfferDraft } from '../offerDraft'
import { Hint, Label, Problem, WholeField, Wrap, type SectionProps } from './parts'

type Props = SectionProps & {
  isNew: boolean
  /** The code a live offer had when opened, which stops working once changed (OFFERS-DESIGN H5). */
  liveCode: string | null
}

const internal = /test|do not use|don.t use|experiment|internal|tmp/i

// "How do they get it?" (OFFERS-DESIGN H, C3): a code or automatic, the code or a run of single-use ones, and the name shoppers see.
export function HowSection({ draft: d, set, errors: e, region, disabled, isNew, liveCode }: Props) {
  const code = d.code.trim().toUpperCase()
  return (
    <SectionCard title={t('offers.editor.sections.how')}>
      <ChoiceRow
        label={t('offers.editor.how.code.title', { code: region.code })}
        sub={t('offers.editor.how.code.sub')}
        selected={d.trigger === 'code'}
        disabled={disabled}
        onPress={() => set({ trigger: 'code', perCustomer: d.perCustomer === '' ? '1' : d.perCustomer })}
      />
      <ChoiceRow label={t('offers.editor.how.automatic.title')} sub={t('offers.editor.how.automatic.sub')} selected={d.trigger === 'automatic'} disabled={disabled} onPress={() => set({ trigger: 'automatic' })} />

      {d.trigger === 'code' && !d.singleUse ? (
        <>
          <TextField
            label={t('offers.editor.codeLabel')}
            value={d.code}
            onChangeText={(text) => set({ code: text.toUpperCase().replace(/\s/g, '') })}
            placeholder={t('offers.editor.codePlaceholder')}
            maxLength={offerLimits.code[1]}
            autoCapitalize="characters"
            editable={!disabled}
            invalid={Boolean(e.code)}
            help={e.code ?? (code ? t('offers.editor.codeOk', { code }) : t('offers.editor.codeHelp'))}
            code
          />
          {disabled ? null : <Button kind="secondary" label={t('offers.editor.generate')} onPress={() => set({ code: generateCode() })} />}
          {liveCode && code !== liveCode ? <Notice text={t('offers.editor.codeChanged', { code: liveCode })} /> : null}
        </>
      ) : null}

      {d.trigger === 'code' && isNew ? (
        <>
          <Switch label={t('offers.editor.singleUse')} value={d.singleUse} disabled={disabled} onChange={() => set({ singleUse: !d.singleUse, perCustomer: d.singleUse ? d.perCustomer : '1', totalUses: d.singleUse ? d.totalUses : '' })} />
          {d.singleUse ? <SingleUseRun draft={d} set={set} error={e.batch} disabled={disabled} /> : null}
        </>
      ) : null}
      {d.trigger === 'code' && !isNew && d.singleUse ? <Hint text={t('offers.editor.singleUseNote')} /> : null}
      {d.trigger === 'automatic' ? <Hint text={t('offers.editor.automaticNote')} /> : null}

      <TextField
        label={t('offers.editor.name')}
        value={d.name}
        onChangeText={(name) => set({ name })}
        maxLength={offerLimits.name}
        autoCapitalize="sentences"
        editable={!disabled}
        invalid={Boolean(e.name)}
        help={e.name ?? `${t('offers.editor.nameHelp')} ${t('offers.editor.namePreview')} ${d.name.trim() || t('offers.editor.unnamed')}`}
      />
      {internal.test(d.name) ? <Notice text={t('offers.editor.nameWarn')} /> : null}
      <TextField
        label={t('offers.editor.note')}
        value={d.note}
        onChangeText={(note) => set({ note })}
        maxLength={offerLimits.note}
        placeholder={t('offers.editor.notePlaceholder')}
        autoCapitalize="sentences"
        editable={!disabled}
        invalid={Boolean(e.note)}
        help={e.note}
      />
    </SectionCard>
  )
}

function SingleUseRun({ draft: d, set, error, disabled }: { draft: OfferDraft; set: (patch: Partial<OfferDraft>) => void; error: string | undefined; disabled: boolean }) {
  return (
    <View style={styles.stack}>
      <WholeField label={t('offers.editor.batchCount')} value={d.batch.count} onChange={(count) => set({ batch: { ...d.batch, count } })} disabled={disabled} />
      <TextField label={t('offers.editor.batchPrefix')} value={d.batch.prefix} onChangeText={(prefix) => set({ batch: { ...d.batch, prefix: prefix.toUpperCase().replace(/\s/g, '') } })} maxLength={offerLimits.prefix} autoCapitalize="characters" editable={!disabled} />
      <Label text={t('offers.editor.batchLength')} />
      <Wrap>
        {codeLengths.map((length) => (
          <Chip key={length} label={String(length)} selected={d.batch.length === String(length)} disabled={disabled} onPress={() => set({ batch: { ...d.batch, length: String(length) } })} />
        ))}
      </Wrap>
      <Problem text={error} />
      <Hint text={t('offers.editor.batchHelp')} />
    </View>
  )
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
})
