import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { formatMoney, minorOf } from '../../../format'
import { locale, t } from '../../../messages'
import { useTheme } from '../../../theme'
import { LinkButton } from '../../common/LinkButton'
import { SectionCard } from '../../common/SectionCard'
import { useFeedback } from '../../shell/Feedback'
import { VersionRow } from './VersionRow'
import { liveVersions, type Draft, type DraftProblem, type DraftVersion } from './draft'
import type { StockContext } from './stock'

type Props = {
  draft: Draft
  update: (change: (draft: Draft) => Draft) => void
  currency: string
  disabled: boolean
  /** Whether this seat may hide the whole product when every version would be hidden. */
  canHideProduct: boolean
  problems: readonly DraftProblem[]
  stock: StockContext | null
  onAdjust: (version: DraftVersion) => void
}

const manyVersions = 12

// The versions the choices make (CATALOG-DESIGN.md D4, D5, D14, D18): a price and counts for each, one price for all or for
// every version of one choice, hiding one, or saying a combination isn't made. Search shows when there are many.
export function VersionsCard({ draft, update, currency, disabled, canHideProduct, problems, stock, onAdjust }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const [search, setSearch] = useState('')
  const live = liveVersions(draft)
  const query = search.trim().toLowerCase()
  const shown = draft.versions.map((version, at) => ({ version, at })).filter(({ version }) => query === '' || version.choices.join(' ').toLowerCase().includes(query))

  const setPrices = (matches: (version: DraftVersion) => boolean, title: string) =>
    feedback.sheet({
      title,
      input: { label: t('products.versions.setPriceLabel'), placeholder: live[0]?.price ?? '', error: t('products.price.missing') },
      confirm: t('products.versions.apply'),
      onConfirm: ({ text }) => {
        const minor = minorOf(text, currency)
        if (typeof minor !== 'number' || minor <= 0) {
          feedback.toast({ message: t('products.price.missing') })
          return
        }
        update((d) => ({ ...d, versions: d.versions.map((version) => (!version.removed && matches(version) ? { ...version, price: text.trim() } : version)) }))
        feedback.toast({ message: t('products.versions.allSet', { price: formatMoney({ amount: minor, currency }, locale) }) })
      },
    })

  const toggle = (version: DraftVersion, at: number) => {
    const set = (patch: Partial<Pick<DraftVersion, 'removed' | 'visible'>>) => update((d) => ({ ...d, versions: d.versions.map((candidate, i) => (i === at ? { ...candidate, ...patch } : candidate)) }))
    if (version.removed) return set({ removed: false })
    if (!version.visible) return set({ visible: true })
    const others = live.filter((candidate) => candidate !== version && candidate.visible).length
    if (others === 0) {
      feedback.sheet({
        title: t('products.versions.hidesAllTitle'),
        body: t('products.versions.hidesAllBody'),
        confirm: canHideProduct ? t('products.versions.hideProduct') : t('products.versions.ok'),
        ...(canHideProduct ? {} : { cancel: null }),
        onConfirm: () => (canHideProduct ? update((d) => ({ ...d, visible: false })) : undefined),
      })
      return
    }
    feedback.sheet({
      title: version.choices.join(' / '),
      body: t('products.versions.notMakeBody'),
      choices: [
        { value: 'hide', label: t('products.versions.hideIt'), sub: t('products.versions.hideItSub') },
        { value: 'remove', label: t('products.versions.notMake'), sub: t('products.versions.notMakeSub') },
      ],
      confirm: t('products.versions.apply'),
      onConfirm: ({ choice }) => set(choice === 'remove' ? { removed: true } : { visible: false }),
    })
  }

  let lastGroup: string | null = null
  const rows = shown.map(({ version, at }) => {
    const group = draft.options.length > 1 ? (version.choices[0] ?? null) : null
    const head = group !== null && group !== lastGroup ? group : null
    lastGroup = group ?? lastGroup
    return { version, at, head }
  })

  return (
    <SectionCard title={t('products.versions.title', { count: live.length })} sub={live.length !== draft.versions.length ? t('products.versions.notMadeCount', { count: draft.versions.length - live.length }) : undefined}>
      {!disabled ? <LinkButton label={t('products.versions.setPrice')} onPress={() => setPrices(() => true, t('products.versions.setPriceTitle'))} /> : null}
      {draft.versions.length > manyVersions ? (
        <TextInput
          accessibilityLabel={t('products.versions.search')}
          value={search}
          onChangeText={setSearch}
          placeholder={t('products.versions.search')}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          style={[styles.search, { color: colors.text, borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}
        />
      ) : null}
      {rows.map(({ version, at, head }) => {
        const priced = minorOf(version.price, currency)
        return (
          <View key={`${at}-${version.choices.join('/')}`} style={styles.item}>
            {head ? (
              <View style={styles.group}>
                <Text style={[styles.groupName, { color: colors.heading }]}>{t('products.versions.allOf', { group: head })}</Text>
                {!disabled ? <LinkButton label={t('products.versions.setGroup', { group: head })} onPress={() => setPrices((candidate) => candidate.choices[0] === head, t('products.versions.setGroupTitle', { group: head }))} /> : null}
              </View>
            ) : null}
            <VersionRow
              draft={draft}
              update={update}
              version={version}
              at={at}
              disabled={disabled}
              priceInvalid={problems.includes('price') && !version.removed && (typeof priced !== 'number' || priced <= 0)}
              stock={stock}
              onAdjust={onAdjust}
              onVisibility={() => toggle(version, at)}
            />
          </View>
        )
      })}
      {query !== '' && shown.length === 0 ? <Text style={{ color: colors.muted, fontSize: 14 }}>{t('products.versions.noMatch')}</Text> : null}
      <Text style={[styles.help, { color: colors.muted }]}>{t('products.versions.help')}</Text>
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  search: { minHeight: 44, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  item: { gap: 6 },
  group: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  groupName: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  help: { fontSize: 12, lineHeight: 18 },
})
