import { StyleSheet, Text, View } from 'react-native'
import type { CollectionSummary } from '../../api/collections'
import { mergeValues, saveFilter, type Filter, type FilterValue } from '../../api/filters'
import { formatList } from '../../format'
import { locale, t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Chip } from '../common/Chip'
import { SectionCard } from '../common/SectionCard'
import { isApiError } from '../../graphql'
import { useFeedback } from '../shell/Feedback'

/** Values that differ only by case, spaces or punctuation ("Off-white", "Off white"): the first is kept. */
export const lookAlikes = (values: readonly FilterValue[]): FilterValue[] | null => {
  const groups = new Map<string, FilterValue[]>()
  for (const v of values) {
    const key = v.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    // A value made only of symbols has no letters to compare, so it is never taken for a look-alike of another.
    if (key === '') continue
    groups.set(key, [...(groups.get(key) ?? []), v])
  }
  return [...groups.values()].find((g) => g.length > 1) ?? null
}

/** How many collections' rules name one of this filter's values. */
const usedBy = (filter: Filter, collections: readonly CollectionSummary[]): number => {
  const ids = new Set(filter.values.map((v) => v.id))
  return collections.filter((c) => c.rules.some((r) => r.valueId !== null && ids.has(r.valueId))).length
}

const usesOf = (v: FilterValue): string => (v.products === 0 ? t('collections.filters.usesNone') : tCount('collections.filters.uses', v.products))

type Props = { filters: readonly Filter[]; collections: readonly CollectionSummary[]; canEdit: boolean; onChanged: () => void }

// CatCollections › Filters at phone width: each filter as a card with its values and how many products use each, the shoppers-or-internal
// switch, and the explainer. Every change that loses or alters something shows its consequence in a sheet first (the card's Prompt).
export function FiltersTab({ filters, collections, canEdit, onChanged }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const client = sessionClient()

  const run = async (work: () => Promise<string>) => {
    try {
      feedback.toast({ message: await work() })
    } catch (error) {
      feedback.toast({ message: errorMessage(error, 'filters') })
      if (!isApiError(error, 'STALE_REVISION')) return
    }
    onChanged()
  }

  const write = (f: Filter, patch: { shopperVisible?: boolean; values?: { id: string | null; name: string }[] }) =>
    saveFilter(client, { id: f.id, revision: f.revision, name: f.name, position: f.position, shopperVisible: patch.shopperVisible ?? f.shopperVisible, values: patch.values ?? f.values.map((v) => ({ id: v.id, name: v.name })) })

  const create = () =>
    feedback.sheet({
      title: t('collections.filters.newTitle'),
      body: t('collections.filters.newBody'),
      input: { label: t('collections.filters.newName'), placeholder: t('collections.filters.newPlaceholder'), error: t('collections.filters.newMissing'), single: true },
      confirm: t('collections.filters.newConfirm'),
      saves: true,
      onConfirm: ({ text }) =>
        run(async () => {
          await saveFilter(client, { id: null, revision: null, name: text, position: Math.max(-1, ...filters.map((f) => f.position)) + 1, shopperVisible: true, values: [] })
          return t('collections.filters.created', { name: text })
        }),
    })

  const addValue = (f: Filter) =>
    feedback.sheet({
      title: t('collections.filters.addTitle', { name: f.name }),
      input: { label: t('collections.filters.addValue'), placeholder: t('collections.filters.addPlaceholder'), error: t('collections.filters.addMissing'), single: true },
      confirm: t('collections.filters.addConfirm'),
      saves: true,
      onConfirm: ({ text }) =>
        run(async () => {
          await write(f, { values: [...f.values.map((v) => ({ id: v.id, name: v.name })), { id: null, name: text }] })
          return t('collections.filters.added', { value: text })
        }),
    })

  const rename = (f: Filter, v: FilterValue) =>
    feedback.sheet({
      title: t('collections.filters.renameTitle', { value: v.name }),
      body: usesOf(v),
      input: { label: t('collections.filters.renameTo'), error: t('collections.filters.renameMissing'), initial: v.name, single: true },
      confirm: t('collections.filters.renameConfirm'),
      saves: true,
      onConfirm: ({ text }) => {
        if (text === v.name) return
        return run(async () => {
          await write(f, { values: f.values.map((x) => ({ id: x.id, name: x.id === v.id ? text : x.name })) })
          return tCount('collections.filters.renamed', v.products, { value: text })
        })
      },
    })

  const remove = (f: Filter, v: FilterValue) =>
    feedback.sheet({
      title: t('collections.filters.deleteTitle', { value: v.name }),
      body: v.products === 0 ? t('collections.filters.deleteNone') : tCount('collections.filters.deleteBody', v.products),
      confirm: t('collections.filters.deleteConfirm'),
      danger: true,
      saves: true,
      onConfirm: () =>
        run(async () => {
          await write(f, { values: f.values.filter((x) => x.id !== v.id).map((x) => ({ id: x.id, name: x.name })) })
          return t('collections.filters.deleted', { value: v.name })
        }),
    })

  const manage = (f: Filter, v: FilterValue) =>
    feedback.menu({
      title: t('collections.filters.manageTitle', { value: v.name, name: f.name }),
      sub: usesOf(v),
      items: [
        { key: 'rename', label: t('collections.filters.rename'), onPress: () => rename(f, v) },
        { key: 'delete', label: t('collections.filters.delete'), danger: true, onPress: () => remove(f, v) },
      ],
    })

  const switchWho = (f: Filter) =>
    feedback.sheet({
      title: t(f.shopperVisible ? 'collections.filters.makeInternalTitle' : 'collections.filters.makeShopperTitle', { name: f.name }),
      body: t(f.shopperVisible ? 'collections.filters.makeInternalBody' : 'collections.filters.makeShopperBody', { name: f.name }),
      confirm: t(f.shopperVisible ? 'collections.filters.makeInternalConfirm' : 'collections.filters.makeShopperConfirm'),
      saves: true,
      onConfirm: () =>
        run(async () => {
          await write(f, { shopperVisible: !f.shopperVisible })
          return t(f.shopperVisible ? 'collections.filters.nowInternal' : 'collections.filters.nowShopper', { name: f.name })
        }),
    })

  const merge = (f: Filter, group: FilterValue[]) => {
    const [keep, ...drop] = group
    if (!keep) return
    feedback.sheet({
      title: t('collections.filters.mergeTitle', { keep: keep.name }),
      body: t('collections.filters.mergeBody', { drop: formatList(drop.map((d) => t('collections.filters.quoted', { value: d.name })), locale), keep: keep.name }),
      confirm: t('collections.filters.mergeConfirm'),
      saves: true,
      onConfirm: () =>
        run(async () => {
          await mergeValues(client, keep.id, drop.map((d) => d.id))
          return t('collections.filters.merged', { keep: keep.name })
        }),
    })
  }

  return (
    <View style={styles.list}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('collections.filters.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.filters.sub')}</Text>
      </View>
      {canEdit ? <Button label={t('collections.filters.create')} onPress={create} saves /> : <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.filters.viewOnly')}</Text>}
      {filters.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.filters.none')}</Text> : null}
      {filters.map((f) => {
        const used = usedBy(f, collections)
        const alike = lookAlikes(f.values)
        return (
          <View key={f.id} accessibilityLabel={f.name} style={[styles.card, { backgroundColor: f.shopperVisible ? colors.surface : colors.page, borderColor: colors.border, borderRadius: radii.card }]}>
            <View style={styles.cardHead}>
              <Text accessibilityRole="header" style={[styles.name, { color: colors.text }]}>
                {f.name}
              </Text>
              <Text style={[styles.sub, { color: colors.muted }]}>{used > 0 ? tCount('collections.filters.usedBy', used) : ''}</Text>
            </View>
            <View style={styles.wrap}>
              <Chip
                label={t(f.shopperVisible ? 'collections.filters.shopper' : 'collections.filters.internal')}
                accessibilityLabel={t(f.shopperVisible ? 'collections.filters.makeInternal' : 'collections.filters.makeShopper', { name: f.name })}
                disabled={!canEdit}
                onPress={() => switchWho(f)}
              />
            </View>
            <View style={styles.wrap}>
              {f.values.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.filters.noValues')}</Text> : null}
              {f.values.map((v) => (
                <Chip key={v.id} label={v.name} hint={String(v.products)} accessibilityLabel={tCount('collections.filters.valueName', v.products, { name: v.name })} disabled={!canEdit} onPress={() => manage(f, v)} />
              ))}
              {canEdit ? <Chip dashed label={t('collections.filters.add')} accessibilityLabel={t('collections.filters.addLabel', { name: f.name })} onPress={() => addValue(f)} /> : null}
            </View>
            {alike?.[0] && alike[1] ? (
              <View style={[styles.alike, { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder, borderRadius: radii.button }]}>
                <Text style={[styles.sub, { color: colors.warning }]}>{t('collections.filters.lookAlike', { a: alike[0].name, b: alike[1].name })}</Text>
                {canEdit ? <Button kind="secondary" label={t('collections.filters.merge')} onPress={() => merge(f, alike)} saves /> : null}
              </View>
            ) : null}
          </View>
        )
      })}
      <SectionCard title={t('collections.filters.explainTitle')} sub={t('collections.filters.tip')}>
        <Text style={[styles.sub, { color: colors.textStrong }]}>
          <Text style={styles.bold}>{t('collections.filters.choicesLabel')}</Text>
          {t('collections.filters.explainJoin')}
          {t('collections.filters.choices')}
        </Text>
        <Text style={[styles.sub, { color: colors.textStrong }]}>
          <Text style={styles.bold}>{t('collections.filters.filtersLabel')}</Text>
          {t('collections.filters.explainJoin')}
          {t('collections.filters.filtersText')}
        </Text>
        <Text style={[styles.sub, { color: colors.textStrong }]}>
          <Text style={styles.bold}>{t('collections.filters.tagsLabel')}</Text>
          {t('collections.filters.explainJoin')}
          {t('collections.filters.tags')}
        </Text>
      </SectionCard>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  card: { borderWidth: 1, padding: 14, gap: 10 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  alike: { borderWidth: 1, padding: 10, gap: 8 },
  bold: { fontWeight: '700' },
})
