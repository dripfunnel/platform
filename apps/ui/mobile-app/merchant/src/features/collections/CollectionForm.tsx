import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { deleteCollection, saveCollection } from '../../api/collections'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Caret } from '../common/Caret'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { Switch } from '../common/Switch'
import { TextField } from '../common/TextField'
import { TextArea } from '../common/TextArea'
import { SaveBar } from '../common/SaveBar'
import { useFeedback } from '../shell/Feedback'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { collectionsAccess } from './access'
import { blankDraft, collectionInput, draftOf, isCollectionDirty, newRow, nameField, ruleFields, ruleInputs, slugOf, type CollectionDraft, type RuleRow } from './collectionDraft'
import { ChoiceRow } from '../common/ChoiceRow'
import type { CollectionEditorData } from './loadEditor'
import { ProductPicks } from './ProductPicks'
import { RuleSentence } from './RuleSentence'
import { useCollectionPreview, useNames } from './useLiveReads'
import { useLeaveGuard } from './useLeaveGuard'

type Props = { client: ApiClient; data: CollectionEditorData; suggested: string | null }

// CatCollections' editor at phone width: name, how it fills (rules or picks), its parent, visibility, and the live preview. A rule-based
// collection's products are the API's answer (collectionPreview), never worked out here. What this seat may change is the API's list
// of permissions; the server decides every write again.
export function CollectionForm({ client, data, suggested }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const { state } = useShell()
  const { canEdit } = collectionsAccess(data.access, state?.readOnly === true)
  const { collection, filters, collections } = data
  const isNew = collection === null

  const [start] = useState<CollectionDraft>(() => (collection ? draftOf(collection, filters, data.members.map((m) => m.id)) : { ...blankDraft(filters), ...(suggested ? { name: suggested, kind: 'manual' as const } : {}) }))
  const [draft, setDraft] = useState(start)
  const [names, seen] = useNames(data.members)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const dirty = isCollectionDirty(draft, start)
  const guard = useLeaveGuard(dirty && !saving)
  const rules = ruleInputs(draft)
  const preview = useCollectionPreview(client, draft.kind === 'automatic', { match: draft.match, rules, parentId: draft.parentId, inheritParent: draft.inheritParent })

  const set = (patch: Partial<CollectionDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const disabled = !canEdit || saving
  const nameMissing = draft.name.trim() === ''
  const fields = ruleFields(filters, draft.rows)
  const parents = collections.filter((c) => c.id !== draft.id && (c.parentId === null || c.id === draft.parentId))
  const parent = collections.find((c) => c.id === draft.parentId) ?? null
  const slug = collection?.slug ?? (slugOf(draft.name) || t('collections.editor.slugPlaceholder'))
  const count = draft.kind === 'manual' ? draft.productIds.length : preview.status === 'ready' ? preview.data.count : null
  const shown = draft.kind === 'manual' ? draft.productIds.slice(0, 6).map((id) => ({ id, name: names[id] ?? '' })) : preview.status === 'ready' ? preview.data.products : []
  const held = collections.find((c) => c.id === draft.id)?.products ?? count ?? 0
  const name = draft.name.trim() || t('collections.editor.untitled')

  const save = async () => {
    if (nameMissing) return setTried(true)
    setSaving(true)
    setFailure(null)
    try {
      await saveCollection(client, draft.id, draft.revision, collectionInput(draft))
      feedback.toast({ message: t(draft.kind === 'automatic' ? 'collections.editor.savedAuto' : 'collections.editor.saved', { name }) })
      guard.finish()
    } catch (error) {
      setFailure(errorMessage(error, 'collections'))
      setSaving(false)
    }
  }

  const remove = () =>
    feedback.sheet({
      title: t('collections.editor.deleteTitle', { name }),
      body: [tCount('collections.editor.deleteBody', held), data.inMenu === false ? '' : t(data.inMenu ? 'collections.editor.deleteMenu' : 'collections.editor.deleteMenuMaybe')].filter(Boolean).join(' '),
      confirm: t('collections.editor.deleteConfirm'),
      danger: true,
      saves: true,
      onConfirm: async () => {
        if (!draft.id) return
        try {
          await deleteCollection(client, draft.id)
          feedback.toast({ message: t('collections.editor.deleted', { name }) })
          guard.finish()
        } catch (error) {
          setFailure(errorMessage(error, 'collections'))
        }
      },
    })

  const setRow = (key: string, row: RuleRow) => set({ rows: draft.rows.map((r) => (r.key === key ? row : r)) })
  const join = (i: number) => (i === 0 ? t('collections.editor.where') : draft.match === 'any' ? t('collections.editor.or') : t('collections.editor.and'))
  const pickParent = () =>
    feedback.menu({
      title: t('collections.editor.parentTitle'),
      items: [
        { key: 'none', label: t('collections.editor.topLevel'), onPress: () => set({ parentId: null, inheritParent: false }) },
        ...parents.map((p) => ({ key: p.id, label: t('collections.editor.insideOption', { name: p.name }), onPress: () => set({ parentId: p.id, inheritParent: true }) })),
      ],
    })

  return (
    <View style={styles.root}>
      <ShellScreen label={t('collections.screen')}>
        <View style={styles.content}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.heading }]}>
            {isNew ? t('collections.editor.newTitle') : name}
          </Text>
          {!canEdit ? <Notice kind="info" text={t('collections.viewOnly')} /> : null}
          {failure ? <Notice kind="error" text={failure} /> : null}
          <SectionCard title={t('collections.editor.name')}>
            <TextField
              label={t('collections.editor.name')}
              value={draft.name}
              onChangeText={(text) => set({ name: text })}
              placeholder={t('collections.editor.namePlaceholder')}
              maxLength={120}
              editable={!disabled}
              autoCapitalize="sentences"
              invalid={tried && nameMissing}
              help={tried && nameMissing ? t('collections.editor.nameMissing') : t('collections.editor.addressNoDomain', { slug })}
            />
            <TextArea label={t('collections.editor.description')} optional={t('collections.editor.descriptionHint')} value={draft.description} onChangeText={(text) => set({ description: text })} editable={!disabled} lines={2} />
          </SectionCard>

          <SectionCard title={t('collections.editor.fill')}>
            <ChoiceRow label={t('collections.editor.automatic')} sub={t('collections.editor.automaticSub')} selected={draft.kind === 'automatic'} disabled={disabled} onPress={() => set({ kind: 'automatic' })} />
            <ChoiceRow label={t('collections.editor.manual')} sub={t('collections.editor.manualSub')} selected={draft.kind === 'manual'} disabled={disabled} onPress={() => set({ kind: 'manual' })} />
            {draft.kind === 'automatic' ? (
              <View style={styles.rules}>
                <Text style={[styles.sub, { color: colors.textStrong }]}>{t('collections.editor.matchLead')}</Text>
                <View style={styles.wrap}>
                  <MatchChoice label={t('collections.editor.matchAll')} on={draft.match === 'all'} disabled={disabled} onPress={() => set({ match: 'all' })} />
                  <MatchChoice label={t('collections.editor.matchAny')} on={draft.match === 'any'} disabled={disabled} onPress={() => set({ match: 'any' })} />
                </View>
                {draft.rows.map((row, i) => (
                  <RuleSentence key={row.key} row={row} n={i + 1} join={join(i)} fields={fields} disabled={disabled} onChange={(next) => setRow(row.key, next)} onRemove={disabled ? null : () => set({ rows: draft.rows.filter((r) => r.key !== row.key) })} />
                ))}
                {draft.others.length > 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{tCount('collections.editor.kept', draft.others.length)}</Text> : null}
                {!disabled ? <Button kind="secondary" label={t('collections.editor.addRule')} onPress={() => set({ rows: [...draft.rows, newRow(fields[1]?.id ?? fields[0]?.id ?? nameField)] })} /> : null}
                <Text style={[styles.note, { color: colors.warning, backgroundColor: colors.warningSurface, borderRadius: radii.button }]}>
                  {data.currency ? t('collections.editor.priceNote', { currency: data.currency }) : t('collections.editor.priceNoteNoCurrency')}
                </Text>
              </View>
            ) : (
              <ProductPicks client={client} picked={draft.productIds} names={names} disabled={disabled} onSeen={seen} onToggle={(id) => set({ productIds: draft.productIds.includes(id) ? draft.productIds.filter((x) => x !== id) : [...draft.productIds, id] })} />
            )}
          </SectionCard>

          <SectionCard title={t('collections.editor.parentTitle')}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('collections.editor.parentTitle')}: ${parent ? t('collections.editor.insideOption', { name: parent.name }) : t('collections.editor.topLevel')}`}
              disabled={disabled}
              onPress={pickParent}
              style={[styles.select, { borderColor: colors.fieldBorder, borderRadius: radii.button, opacity: disabled ? 0.6 : 1 }]}
            >
              <Text style={[styles.selectText, { color: colors.text }]}>
                {parent ? t('collections.editor.insideOption', { name: parent.name }) : t('collections.editor.topLevel')}
                <Caret color={colors.text} />
              </Text>
            </Pressable>
            {parent ? (
              <>
                <Switch label={t('collections.editor.inherit', { name: parent.name })} value={draft.inheritParent} disabled={disabled} onChange={(inheritParent) => set({ inheritParent })} />
                <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.editor.flow', { parent: parent.name, parentCount: parent.products, name, count: count === null ? t('collections.editor.countPending') : count })}</Text>
              </>
            ) : null}
          </SectionCard>

          <SectionCard title={count === null ? t('collections.editor.preview') : tCount(draft.kind === 'manual' ? 'collections.editor.picked' : 'collections.editor.matching', count)} sub={t('collections.editor.preview')}>
            {preview.status === 'failed' && draft.kind === 'automatic' ? <Notice kind="error" text={t('collections.editor.previewFailed')} /> : null}
            {preview.status === 'loading' && draft.kind === 'automatic' ? <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.editor.searching')}</Text> : null}
            <View style={styles.tiles}>
              {shown.map((p) => (
                <View key={p.id} style={[styles.tile, { borderColor: colors.border, borderRadius: radii.button }]}>
                  <Text numberOfLines={2} style={[styles.tileName, { color: colors.text }]}>
                    {p.name}
                  </Text>
                </View>
              ))}
            </View>
            {count === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t(draft.kind === 'manual' ? 'collections.editor.noPicksYet' : 'collections.editor.noMatch')}</Text> : null}
          </SectionCard>

          <Switch label={t(draft.visible ? 'collections.editor.visible' : 'collections.editor.hidden')} value={draft.visible} disabled={disabled} onChange={(visible) => set({ visible })} />
          {canEdit && !isNew ? <Button kind="secondary" label={t('collections.editor.delete')} onPress={remove} disabled={saving} saves /> : null}
        </View>
      </ShellScreen>
      {canEdit && (dirty || isNew || failure !== null) ? <SaveBar failed={failure !== null} label={saving ? t('collections.editor.saving') : t('collections.editor.save')} busy={saving} onDiscard={() => setDraft(start)} onSave={() => void save()} /> : null}
    </View>
  )
}

function MatchChoice({ label, on, disabled, onPress }: { label: string; on: boolean; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.match, { borderColor: on ? colors.focus : colors.fieldBorder, backgroundColor: on ? colors.infoSurface : colors.surface, opacity: disabled ? 0.6 : 1 }]}
    >
      <Text style={[styles.matchText, { color: on ? colors.info : colors.textStrong }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  heading: { fontSize: 20, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  rules: { gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  match: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderRadius: 22 },
  matchText: { fontSize: 14, fontWeight: '700' },
  note: { fontSize: 12, lineHeight: 18, padding: 10 },
  select: { minHeight: 50, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center' },
  selectText: { fontSize: 15 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48%', minHeight: 56, borderWidth: 1, padding: 10, justifyContent: 'center' },
  tileName: { fontSize: 13, fontWeight: '700' },
})
