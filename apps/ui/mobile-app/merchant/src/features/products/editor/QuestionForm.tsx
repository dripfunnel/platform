import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../../messages'
import { Button } from '../../common/Button'
import { ChoiceRow } from '../../common/ChoiceRow'
import { LinkButton } from '../../common/LinkButton'
import { Notice } from '../../common/Notice'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { QuestionPrice } from './QuestionPrice'
import { conditionTargets, dependentsOf, maxChoices, moveChoice, newChoice, questionProblems, withValidConditions, type Accept, type ChoiceDraft, type QuestionDraft, type QuestionField } from './questions'

type Props = {
  question: QuestionDraft
  /** Every question, this one at `at` (a new one is appended), for its conditions. */
  all: readonly QuestionDraft[]
  at: number
  currency: string
  versions: readonly { key: string; label: string }[]
  disabled: boolean
  onDone: (question: QuestionDraft) => void
  onClose: () => void
}

const accepts: Accept[] = ['IMAGE', 'PDF', 'IMAGE_PDF']
const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : null)

// One question's form, full screen (merchant FIRST-RELEASE §2; CATALOG-DESIGN U4–U10): the change reaches the product only on Done,
// and the product's own Save sends it.
export function QuestionForm({ question, all, at, currency, versions, disabled, onDone, onClose }: Props) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState<QuestionDraft>(question)
  const [shown, setShown] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const set = (change: Partial<QuestionDraft>) => setQ((current) => ({ ...current, ...change }))
  const list = [...all.slice(0, at), q, ...all.slice(at + 1)]
  const problems = shown ? questionProblems(withValidConditions(list), currency, versions.length > 1 ? versions.map((v) => v.key) : null).filter((p) => p.question === q.key) : []
  const has = (field: QuestionField, choice: string | null = null) => problems.some((p) => p.field === field && p.choice === choice)
  const priced = q.choices.some((c) => c.price !== null)
  const many = q.maxPicks.trim() !== '1'

  const setChoice = (key: string, change: Partial<ChoiceDraft>) => set({ choices: q.choices.map((c) => (c.key === key ? { ...c, ...change } : c)) })
  const removeChoice = (c: ChoiceDraft) => {
    const dependent = dependentsOf(all, q.key, c.key)[0]
    if (dependent) setNotice(t('products.questions.form.conditionCleared', { question: dependent.label || t('products.questions.untitled') }))
    set({ choices: q.choices.filter((x) => x.key !== c.key) })
  }
  const done = () => {
    setShown(true)
    const found = questionProblems(withValidConditions(list), currency, versions.length > 1 ? versions.map((v) => v.key) : null).some((p) => p.question === q.key)
    if (!found) onDone(q)
  }

  const picksWords = () => {
    const min = whole(q.minPicks)
    const max = whole(q.maxPicks)
    return min !== null && max !== null && min > max ? t('products.questions.problem.minAboveMax', { min, max }) : t('products.questions.problem.picks')
  }
  const targets = conditionTargets(list, at)
  const dependedOn = dependentsOf(all, q.key).length > 0
  const ticked = (key: string) => q.versions === null || q.versions.includes(key)
  const tick = (key: string, on: boolean) => {
    const now = versions.map((v) => v.key).filter((k) => (k === key ? on : ticked(k)))
    set({ versions: now.length === versions.length ? null : now })
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, { backgroundColor: colors.page, paddingTop: insets.top }]}>
        <View style={[styles.header, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <LinkButton label={t('common.cancel')} onPress={onClose} />
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: colors.heading }]}>
            {t(`products.questions.kinds.${q.kind}`)}
          </Text>
          {disabled ? <View style={styles.side} /> : <LinkButton label={t('products.questions.form.done')} onPress={done} />}
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          {notice ? <Notice text={notice} /> : null}
          <TextField label={t('products.questions.form.label')} value={q.label} onChangeText={(label) => set({ label })} invalid={has('label')} editable={!disabled} autoCapitalize="sentences" />
          {has('label') ? <Problem text={t('products.questions.problem.label')} /> : null}
          <TextField label={t('products.questions.form.help')} value={q.help} onChangeText={(help) => set({ help })} editable={!disabled} autoCapitalize="sentences" />

          {q.kind === 'CHOICE' ? (
            <>
              <Text style={[styles.heading, { color: colors.text }]}>{t('products.questions.form.choices')}</Text>
              {has('choices') ? <Problem text={t('products.questions.problem.choices')} /> : null}
              {q.choices.map((c, i) => {
                const name = c.label || t('products.questions.form.choiceN', { n: i + 1 })
                return (
                  <View key={c.key} style={[styles.choice, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <TextField label={t('products.questions.form.choiceN', { n: i + 1 })} value={c.label} onChangeText={(label) => setChoice(c.key, { label })} invalid={has('label', c.key)} editable={!disabled} autoCapitalize="sentences" />
                    {has('label', c.key) ? <Problem text={t('products.questions.problem.choiceLabel')} /> : null}
                    <Switch label={t('products.questions.form.available')} value={c.available} disabled={disabled} onChange={(available) => setChoice(c.key, { available })} />
                    {many ? (
                      <TextField label={t('products.questions.form.quantity')} value={c.maxQuantity} onChangeText={(maxQuantity) => setChoice(c.key, { maxQuantity })} keyboardType="number-pad" invalid={has('quantity', c.key)} editable={!disabled} />
                    ) : null}
                    {has('quantity', c.key) ? <Problem text={t('products.questions.problem.quantity')} /> : null}
                    {c.photoAssetId ? (
                      <View style={styles.row}>
                        <Text style={[styles.note, { color: colors.muted }]}>{t('products.questions.form.hasPhoto')}</Text>
                        {disabled ? null : <LinkButton label={t('products.questions.form.removePhoto')} accessibilityLabel={t('products.questions.form.removePhotoOf', { name })} onPress={() => setChoice(c.key, { photoAssetId: null })} />}
                      </View>
                    ) : null}
                    <QuestionPrice price={c.price} onChange={(price) => setChoice(c.key, { price })} kind="CHOICE" name={name} currency={currency} versions={versions} invalid={has('price', c.key)} disabled={disabled} />
                    {disabled ? null : (
                      <View style={styles.row}>
                        {i > 0 ? <LinkButton label={t('products.questions.moveUp')} accessibilityLabel={t('products.questions.moveUpNamed', { name })} onPress={() => set({ choices: moveChoice(q.choices, i, -1) })} /> : null}
                        {i < q.choices.length - 1 ? <LinkButton label={t('products.questions.moveDown')} accessibilityLabel={t('products.questions.moveDownNamed', { name })} onPress={() => set({ choices: moveChoice(q.choices, i, 1) })} /> : null}
                        <LinkButton danger label={t('products.questions.form.removeChoice')} accessibilityLabel={t('products.questions.form.removeChoiceNamed', { name })} onPress={() => removeChoice(c)} />
                      </View>
                    )}
                  </View>
                )
              })}
              {disabled ? null : <Button kind="secondary" label={t('products.questions.form.addChoice')} disabled={q.choices.length >= maxChoices} onPress={() => set({ choices: [...q.choices, newChoice()] })} />}
              {q.choices.length >= maxChoices ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.questions.choiceLimit')}</Text> : null}

              <Text style={[styles.heading, { color: colors.text }]}>{t('products.questions.form.howMany')}</Text>
              <ChoiceRow label={t('products.questions.form.pickOne')} selected={!many} disabled={disabled} onPress={() => set({ maxPicks: '1', minPicks: Number(q.minPicks) >= 1 ? '1' : '0', freePicks: '0' })} />
              <ChoiceRow label={t('products.questions.form.pickUpTo')} selected={many} disabled={disabled} onPress={() => set({ maxPicks: many ? q.maxPicks : '3' })} />
              {many ? (
                <>
                  <TextField label={t('products.questions.form.maxPicks')} value={q.maxPicks} onChangeText={(maxPicks) => set({ maxPicks })} keyboardType="number-pad" invalid={has('picks')} editable={!disabled} />
                  <TextField label={t('products.questions.form.minPicks')} value={q.minPicks} onChangeText={(minPicks) => set({ minPicks })} keyboardType="number-pad" invalid={has('picks')} editable={!disabled} />
                </>
              ) : null}
              {has('picks') ? <Problem text={picksWords()} /> : null}
              <Switch label={t('products.questions.form.required')} value={Number(q.minPicks) >= 1} disabled={disabled} onChange={(on) => set({ minPicks: on ? (Number(q.minPicks) >= 1 ? q.minPicks : '1') : '0' })} />
              {many && priced ? (
                <TextField label={t('products.questions.form.freePicks')} help={t('products.questions.form.freePicksHelp')} value={q.freePicks} onChangeText={(freePicks) => set({ freePicks })} keyboardType="number-pad" invalid={has('free')} editable={!disabled} />
              ) : null}
              {has('free') ? <Problem text={t('products.questions.problem.free')} /> : null}
            </>
          ) : null}

          {q.kind === 'TEXT' ? (
            <>
              <ChoiceRow label={t('products.questions.form.singleLine')} selected={!q.multiline} disabled={disabled} onPress={() => set({ multiline: false })} />
              <ChoiceRow label={t('products.questions.form.paragraph')} selected={q.multiline} disabled={disabled} onPress={() => set({ multiline: true })} />
              <TextField label={t('products.questions.form.maxLength')} help={t('products.questions.form.maxLengthHelp')} value={q.maxLength} onChangeText={(maxLength) => set({ maxLength })} keyboardType="number-pad" invalid={has('maxLength')} editable={!disabled} />
              {has('maxLength') ? <Problem text={t('products.questions.problem.maxLength')} /> : null}
              <TextField label={t('products.questions.form.example')} value={q.example} onChangeText={(example) => set({ example })} placeholder={t('products.questions.form.examplePlaceholder')} editable={!disabled} autoCapitalize="sentences" />
            </>
          ) : null}

          {q.kind === 'UPLOAD' ? (
            <>
              <Text style={[styles.heading, { color: colors.text }]}>{t('products.questions.form.accepts')}</Text>
              {accepts.map((accept) => (
                <ChoiceRow key={accept} label={t(`products.questions.form.accept.${accept}`)} selected={q.accept === accept} disabled={disabled} onPress={() => set({ accept })} />
              ))}
              <TextField label={t('products.questions.form.maxFiles')} value={q.maxFiles} onChangeText={(maxFiles) => set({ maxFiles })} keyboardType="number-pad" invalid={has('maxFiles')} editable={!disabled} />
              {has('maxFiles') ? <Problem text={t('products.questions.problem.maxFiles')} /> : null}
              <Text style={[styles.note, { color: colors.muted }]}>{t('products.questions.form.fileSize')}</Text>
            </>
          ) : null}

          {q.kind !== 'CHOICE' ? (
            <>
              <Switch label={t('products.questions.form.required')} value={q.required} disabled={disabled} onChange={(required) => set({ required })} />
              <QuestionPrice price={q.price} onChange={(price) => set({ price })} kind={q.kind} name={q.label || t('products.questions.untitled')} currency={currency} versions={versions} invalid={has('price')} disabled={disabled} />
            </>
          ) : null}

          <Text style={[styles.heading, { color: colors.text }]}>{t('products.questions.form.onlyWhen')}</Text>
          {dependedOn ? (
            <Text style={[styles.note, { color: colors.muted }]}>{t('products.questions.form.dependedOn')}</Text>
          ) : targets.length === 0 ? (
            <Text style={[styles.note, { color: colors.muted }]}>{t('products.questions.form.noTargets')}</Text>
          ) : (
            <>
              <ChoiceRow label={t('products.questions.form.always')} selected={q.shownIf === null} disabled={disabled} onPress={() => set({ shownIf: null })} />
              {targets.flatMap((target) =>
                target.choices.map((c) => (
                  <ChoiceRow
                    key={`${target.key}-${c.key}`}
                    label={t('products.questions.form.when', { question: target.label || t('products.questions.untitled'), choice: c.label })}
                    selected={q.shownIf?.choice === c.key}
                    disabled={disabled}
                    onPress={() => set({ shownIf: { question: target.key, choice: c.key } })}
                  />
                )),
              )}
            </>
          )}

          {versions.length > 1 ? (
            <>
              <Text style={[styles.heading, { color: colors.text }]}>{t('products.questions.form.versions')}</Text>
              {versions.map((v) => (
                <Switch key={v.key} label={v.label} value={ticked(v.key)} disabled={disabled} onChange={(on) => tick(v.key, on)} />
              ))}
              {has('versions') ? <Problem text={t('products.questions.problem.versions')} /> : null}
              {has('versionsChanged') ? <Problem text={t('products.questions.problem.versionsChanged')} /> : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function Problem({ text }: { text: string }) {
  const { colors } = useTheme()
  return (
    <Text accessibilityRole="alert" style={[styles.note, { color: colors.danger }]}>
      {text}
    </Text>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, minHeight: 52, borderBottomWidth: 1 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800' },
  side: { width: 60 },
  content: { padding: 14, gap: 12 },
  heading: { fontSize: 15, fontWeight: '800', paddingTop: 6 },
  choice: { gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 },
  note: { fontSize: 13, lineHeight: 18 },
})
