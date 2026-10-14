import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { SectionCard } from '../../common/SectionCard'
import { useFeedback } from '../../shell/Feedback'
import { OptionRow } from './OptionRow'
import { addKindToVersions, liveVersions, maxOptions, maxVersions, moveOptionUp, newVersionCount, removeChoice, removeKind, syncVersions, versionCountOf, versionsMade, versionsWith, type Draft } from './draft'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; disabled: boolean; invalid: boolean }

const kindKeys = ['size', 'colour', 'material', 'style', 'packOf', 'scent', 'flavour'] as const

// Choices (CATALOG-DESIGN.md D1–D11): the kinds a product comes in and the choices of each; "Create versions" makes one version
// for every combination. What a removal takes with it is said before it happens, and that past orders keep their record.
export function ChoicesCard({ draft, update, disabled, invalid }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const made = versionsMade(draft)
  const live = liveVersions(draft)
  const count = versionCountOf(draft.options)
  const fresh = newVersionCount(draft)
  const used = new Set(draft.options.map((option) => option.name.trim().toLowerCase()))
  const names = kindKeys.map((key) => t(`products.choices.kinds.${key}`)).filter((name) => !used.has(name.toLowerCase()))

  const addKind = (name: string) => {
    if (draft.options.length >= maxOptions) {
      feedback.toast({ message: t('products.choices.upToThree') })
      return
    }
    if (draft.options.length > 0 && live.some((version) => version.choices.length > 0)) {
      feedback.sheet({
        title: tCount('products.choices.needTitle', live.length, { name }),
        body: t('products.choices.needBody'),
        input: { label: t('products.choices.needLabel', { name }), placeholder: t('products.choices.needPlaceholder'), error: t('products.choices.needMissing') },
        confirm: t('products.choices.needConfirm', { name }),
        onConfirm: ({ text }) => update((d) => addKindToVersions(d, name, text)),
      })
      return
    }
    update((d) => ({ ...d, options: [...d.options, { id: null, name, values: [] }] }))
  }

  const chooseKind = () =>
    feedback.menu({
      title: t('products.choices.addKindTitle'),
      items: [...names.map((name) => ({ key: name, label: name, onPress: () => addKind(name) })), { key: 'custom', label: t('products.choices.custom'), onPress: askCustom }],
    })

  function askCustom() {
    feedback.sheet({ title: t('products.choices.customTitle'), input: { label: t('products.choices.customLabel'), error: t('products.choices.customMissing') }, confirm: t('products.choices.addKind'), onConfirm: ({ text }) => addKind(text) })
  }

  const addChoices = (at: number, added: string[]) => {
    const option = draft.options[at]
    if (!option) return
    const known = new Set(option.values.map((value) => value.name.toLowerCase()))
    const typed = added.filter((name, i) => !known.has(name.toLowerCase()) && added.findIndex((other) => other.toLowerCase() === name.toLowerCase()) === i)
    const dupes = added.filter((name) => !typed.includes(name))
    if (dupes[0]) feedback.toast({ message: t('products.choices.duplicate', { name: dupes[0] }) })
    if (typed.length === 0) return
    update((d) => ({ ...d, options: d.options.map((candidate, i) => (i === at ? { ...candidate, values: [...candidate.values, ...typed.map((name) => ({ id: null, name }))] } : candidate)) }))
    if (made) feedback.toast({ message: t('products.choices.addedUpdate', { name: typed[0] ?? '' }) })
  }

  const askRemoveChoice = (at: number, name: string) => {
    const gone = versionsWith(draft, at, name)
    if (gone.length === 0) {
      update((d) => removeChoice(d, at, name))
      return
    }
    feedback.sheet({
      tag: t('products.choices.removeChoiceTag'),
      danger: true,
      title: t('products.choices.removeValueTitle', { name }),
      body: `${tCount('products.choices.removeValueBody', gone.length, { list: gone.map((version) => version.choices.join(' / ')).join(', ') })}\n${t('products.choices.cantUndo')}`,
      confirm: t('products.choices.removeValueConfirm', { name }),
      onConfirm: () => update((d) => removeChoice(d, at, name)),
    })
  }

  const askRemoveKind = (at: number) => {
    const option = draft.options[at]
    if (!option) return
    if (!made) {
      update((d) => ({ ...d, options: d.options.filter((_, i) => i !== at) }))
      return
    }
    feedback.sheet({
      tag: t('products.choices.removeKindTag'),
      danger: true,
      title: t('products.choices.removeKindTitle', { name: option.name }),
      body: t('products.choices.removeKindBody'),
      confirm: t('products.choices.removeKindConfirm', { name: option.name }),
      onConfirm: () => update((d) => removeKind(d, at)),
    })
  }

  const generate = () => {
    update((d) => ({ ...d, versions: syncVersions(d) }))
    feedback.toast({ message: tCount('products.choices.ready', count) })
  }

  if (draft.options.length === 0) {
    return (
      <SectionCard title={t('products.choices.ask')} sub={t('products.choices.askSub')}>
        {!disabled ? <Button kind="secondary" label={t('products.choices.add')} onPress={chooseKind} /> : null}
      </SectionCard>
    )
  }

  const tooMany = count > maxVersions
  const parts = draft.options.map((option) => `${option.values.length} ${option.name.trim().toLowerCase()}`).join(' × ')
  const status = tooMany
    ? { text: t('products.choices.tooMany', { count }), tone: 'danger' as const }
    : !made
      ? { text: count > 0 ? tCount('products.choices.makes', count, { parts }) : t('products.choices.addChoicesFirst'), tone: count > 0 ? ('success' as const) : ('neutral' as const) }
      : fresh > 0
        ? { text: tCount('products.choices.newOnes', fresh), tone: 'success' as const }
        : { text: t('products.choices.upToDate'), tone: 'neutral' as const }
  const tone = status.tone === 'danger' ? { bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger } : status.tone === 'success' ? { bg: colors.successSurface, border: colors.successBorder, fg: colors.success } : { bg: colors.page, border: colors.border, fg: colors.muted }
  const canGenerate = !disabled && !tooMany && count > 0 && (!made || fresh > 0)

  return (
    <SectionCard title={t('products.choices.title')} sub={t('products.choices.limits')}>
      {draft.options.map((option, at) => (
        <OptionRow
          key={option.id ?? `new-${at}`}
          option={option}
          disabled={disabled}
          onRename={(name) => update((d) => ({ ...d, options: d.options.map((candidate, i) => (i === at ? { ...candidate, name } : candidate)) }))}
          onUp={at > 0 ? () => update((d) => moveOptionUp(d, at)) : null}
          onRemove={() => askRemoveKind(at)}
          onAdd={(added) => addChoices(at, added)}
          onRemoveChoice={(name) => askRemoveChoice(at, name)}
        />
      ))}
      {!disabled && draft.options.length < maxOptions ? (
        <View style={styles.suggest}>
          <Text style={[styles.suggestLabel, { color: colors.muted }]}>{t('products.choices.addAnother')}</Text>
          {names.slice(0, 5).map((name) => (
            <Pressable key={name} accessibilityRole="button" onPress={() => addKind(name)} style={[styles.suggestChip, { backgroundColor: colors.neutralSurface }]}>
              <Text style={{ color: colors.textStrong, fontSize: 13 }}>{`+ ${name}`}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={askCustom} style={[styles.suggestChip, { backgroundColor: colors.neutralSurface }]}>
            <Text style={{ color: colors.textStrong, fontSize: 13 }}>{`+ ${t('products.choices.custom')}`}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.status, { backgroundColor: tone.bg, borderColor: tone.border, borderRadius: radii.button }]}>
        <Text accessibilityLiveRegion="polite" style={[styles.statusText, { color: tone.fg }]}>
          {status.text}
        </Text>
      </View>
      {invalid && !made ? <Text style={{ color: colors.danger, fontSize: 13 }}>{t('products.refused.VERSION_CHOICES')}</Text> : null}
      {canGenerate ? <Button label={made ? t('products.choices.update') : tCount('products.choices.create', count)} onPress={generate} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  suggest: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  suggestLabel: { fontSize: 13 },
  suggestChip: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, justifyContent: 'center' },
  status: { padding: 12, borderWidth: 1 },
  statusText: { fontSize: 14, lineHeight: 20 },
})
