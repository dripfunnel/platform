import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { CollectionSummary } from '../../api/collections'
import type { Filter } from '../../api/filters'
import { formatMoney } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Chip } from '../common/Chip'
import { nested, ruleCount, sentenceOf, type SentenceWords } from './collectionDraft'
import type { SeasonKey } from './seasonal'

const sentenceWords = (): SentenceWords => ({
  is: t('collections.sentence.is'),
  or: t('collections.sentence.or'),
  and: t('collections.sentence.and'),
  orJoin: t('collections.sentence.orJoin'),
  nameContains: t('collections.sentence.nameContains'),
  product: t('collections.sentence.product'),
  version: t('collections.sentence.version'),
  priceRange: t('collections.sentence.priceRange'),
})

type Props = {
  collections: readonly CollectionSummary[]
  filters: readonly Filter[]
  canEdit: boolean
  seasonal: readonly SeasonKey[]
  currency: string | null
  onOpen: (id: string) => void
  onCreate: (name?: string) => void
}

/** "Gifts under ₹999" in the empty state: a round amount in the store's own currency, never a country assumed. */
const giftPrice = (currency: string | null): string | null => (currency ? formatMoney({ amount: currency === 'INR' ? '99900' : '5000', currency }, locale).replace(/[.,]00$/, '') : null)

const subOf = (c: CollectionSummary, all: readonly CollectionSummary[], filters: readonly Filter[]): string => {
  const parent = all.find((p) => p.id === c.parentId)
  if (parent) return t(c.inheritParent ? 'collections.list.insideOnly' : 'collections.list.inside', { name: parent.name })
  return c.kind === 'automatic' ? sentenceOf(c, filters, sentenceWords()) : tCount('collections.list.picked', c.products)
}

// CatCollections' list at phone width: seasonal ideas, then every collection as a card with its children indented under it, or the
// empty state. What a rule-based collection holds is the API's count; the app never works it out (the card's Prompt).
export function CollectionsList({ collections, filters, canEdit, seasonal, currency, onOpen, onCreate }: Props) {
  const { colors, radii } = useTheme()
  const names = new Set(collections.map((c) => c.name.toLowerCase()))
  const ideas = seasonal.filter((key) => !names.has(t(`collections.seasonal.names.${key}`).toLowerCase()))
  const price = giftPrice(currency)

  return (
    <View style={styles.list}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('collections.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.sub')}</Text>
      </View>
      {canEdit ? <Button label={t('collections.create')} onPress={() => onCreate()} saves /> : <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.viewOnly')}</Text>}
      {canEdit && ideas.length > 0 ? (
        <View style={[styles.ideas, { backgroundColor: colors.surface, borderColor: colors.warningBorder, borderRadius: radii.button }]}>
          <Text style={[styles.ideasLabel, { color: colors.warning }]}>{t('collections.seasonal.label')}</Text>
          <View style={styles.wrap}>
            {ideas.map((key) => (
              <Chip key={key} label={t('collections.seasonal.add', { name: t(`collections.seasonal.names.${key}`) })} onPress={() => onCreate(t(`collections.seasonal.names.${key}`))} />
            ))}
          </View>
        </View>
      ) : null}
      {collections.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          <Text accessibilityRole="header" style={[styles.emptyTitle, { color: colors.heading }]}>
            {t('collections.empty.title')}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{price ? t('collections.empty.body', { price }) : t('collections.empty.bodyNoPrice')}</Text>
          {canEdit ? <Button label={t('collections.empty.action')} onPress={() => onCreate()} saves /> : null}
        </View>
      ) : (
        nested(collections).map(({ c, depth }) => {
          const updating = c.kind === 'automatic' && c.computedAt === null
          const rules = ruleCount(c, filters)
          return (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={t('collections.list.open', { name: c.name })}
              onPress={() => onOpen(c.id)}
              style={[styles.card, { marginLeft: depth * 20, backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
            >
              <View style={styles.cardText}>
                <Text style={[styles.name, { color: colors.text }]}>{c.name}</Text>
                <Text numberOfLines={2} style={[styles.sub, { color: colors.muted }]}>
                  {subOf(c, collections, filters)}
                </Text>
                <Text style={[styles.sub, { color: colors.muted }]}>{c.kind === 'automatic' ? tCount('collections.list.automatic', rules) : t('collections.list.handPicked')}</Text>
              </View>
              <View style={styles.cardSide}>
                <Text style={[styles.count, { color: updating ? colors.focus : colors.textStrong }]}>{updating ? t('collections.list.updating', { count: c.products }) : tCount('collections.list.products', c.products)}</Text>
                <Text style={[styles.sub, { color: c.visible ? colors.success : colors.muted }]}>{c.visible ? t('collections.list.visible') : t('collections.list.hidden')}</Text>
              </View>
            </Pressable>
          )
        })
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  ideas: { borderWidth: 1, borderStyle: 'dashed', padding: 12, gap: 8 },
  ideasLabel: { fontSize: 13, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  empty: { borderWidth: 1, padding: 24, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
  card: { minHeight: 64, borderWidth: 1, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardText: { flex: 1, gap: 2 },
  cardSide: { alignItems: 'flex-end', gap: 2, maxWidth: '40%' },
  name: { fontSize: 15, fontWeight: '700' },
  count: { fontSize: 13, textAlign: 'right' },
})
