import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Icon } from '../../shell/Icon'
import type { DraftModule } from './storyDraft'

type Props = {
  module: DraftModule
  open: boolean
  onToggle: () => void
  /** The things publishing asked for in this module, in words. */
  gapWords: string[]
  canEdit: boolean
  onUp: (() => void) | null
  onDown: (() => void) | null
  onDuplicate: (() => void) | null
  onDelete: () => void
  children: ReactNode
}

// One module of the story as a card (CatAPlus; CATALOG-DESIGN.md Q1): its kind and headline, open to edit it and to move, copy
// or remove it. A module publishing marked says what is still to fill in.
export function ModuleCard({ module, open, onToggle, gapWords, canEdit, onUp, onDown, onDuplicate, onDelete, children }: Props) {
  const { colors, radii } = useTheme()
  const flagged = gapWords.length > 0
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: flagged ? colors.danger : open ? colors.focus : colors.border, borderRadius: radii.card, borderWidth: flagged || open ? 2 : 1 }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={t('products.story.select', { name: t(`products.story.kinds.${module.kind}`) })} onPress={onToggle} style={styles.head}>
        <View style={styles.titles}>
          <Text style={[styles.kind, { color: colors.muted }]}>{t(`products.story.kinds.${module.kind}`)}</Text>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
            {module.title.trim() || t(`products.story.placeholders.${module.kind}`)}
          </Text>
        </View>
        <Icon name="chevron" size={18} color={colors.muted} />
      </Pressable>
      {flagged ? <Text accessibilityRole="alert" style={[styles.gaps, { color: colors.danger }]}>{gapWords.join(' · ')}</Text> : null}
      {open ? (
        <View style={styles.body}>
          {children}
          {canEdit ? (
            <View style={styles.actions}>
              {onUp ? <Action label={t('products.story.up')} onPress={onUp} /> : null}
              {onDown ? <Action label={t('products.story.down')} onPress={onDown} /> : null}
              {onDuplicate ? <Action label={t('products.story.duplicate')} onPress={onDuplicate} /> : null}
              <Action label={t('products.story.delete')} onPress={onDelete} danger />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Action({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  const { colors, radii } = useTheme()
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.action, { borderColor: danger ? colors.dangerBorder : colors.fieldBorder, borderRadius: radii.button }]}>
      <Text style={{ color: danger ? colors.danger : colors.textStrong, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  head: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  titles: { flex: 1, gap: 2 },
  kind: { fontSize: 12 },
  title: { fontSize: 15, fontWeight: '700' },
  gaps: { fontSize: 12, paddingHorizontal: 14, paddingBottom: 8 },
  body: { padding: 14, gap: 14 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
