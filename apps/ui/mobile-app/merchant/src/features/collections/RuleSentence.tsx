import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Filter } from '../../api/filters'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Caret } from '../common/Caret'
import { Chip } from '../common/Chip'
import { TextField } from '../common/TextField'
import { useFeedback } from '../shell/Feedback'
import { Icon } from '../shell/Icon'
import { nameField, type RuleRow } from './collectionDraft'

type Props = {
  row: RuleRow
  n: number
  /** "Where", "and" or "or": how this rule joins the one above it. */
  join: string
  fields: readonly Filter[]
  disabled: boolean
  onChange: (row: RuleRow) => void
  onRemove: (() => void) | null
}

// One sentence of the rule builder (CATALOG-DESIGN.md H4): "Where Fabric is Linen or Cotton", or "name contains shirt". Picking another
// field starts it over, as the values belong to the field.
export function RuleSentence({ row, n, join, fields, disabled, onChange, onRemove }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const filter = fields.find((f) => f.id === row.field)
  const fieldName = row.field === nameField ? t('collections.editor.nameContains') : (filter?.name ?? '')

  const pickField = () =>
    feedback.menu({
      title: t('collections.editor.field', { n }),
      items: [
        ...fields.map((f) => ({ key: f.id, label: `${f.id === row.field ? '✓ ' : ''}${f.name}`, onPress: () => onChange({ ...row, field: f.id, values: [], text: '' }) })),
        { key: nameField, label: `${row.field === nameField ? '✓ ' : ''}${t('collections.editor.nameContains')}`, onPress: () => onChange({ ...row, field: nameField, values: [], text: '' }) },
      ],
    })

  return (
    <View style={[styles.rule, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.button }]}>
      <View style={styles.top}>
        <Text style={[styles.join, { color: colors.muted }]}>{join}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('collections.editor.field', { n })}: ${fieldName}`}
          disabled={disabled}
          onPress={pickField}
          style={[styles.field, { borderColor: colors.fieldBorder, borderRadius: radii.button, opacity: disabled ? 0.6 : 1 }]}
        >
          <Text style={[styles.fieldText, { color: colors.text }]}>
            {fieldName}
            <Caret color={colors.text} />
          </Text>
        </Pressable>
        {onRemove ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('collections.editor.removeRule', { n })} onPress={onRemove} style={styles.remove}>
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {row.field === nameField ? (
        <TextField label={t('collections.editor.text', { n })} value={row.text} onChangeText={(text) => onChange({ ...row, text })} placeholder={t('collections.editor.textPlaceholder')} maxLength={60} editable={!disabled} autoCapitalize="none" />
      ) : (
        <View style={styles.values}>
          <Text style={[styles.is, { color: colors.textStrong }]}>{t('collections.editor.is')}</Text>
          {filter?.values.map((v) => {
            const on = row.values.includes(v.id)
            return <Chip key={v.id} label={v.name} selected={on} disabled={disabled} onPress={() => onChange({ ...row, values: on ? row.values.filter((x) => x !== v.id) : [...row.values, v.id] })} />
          })}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  rule: { borderWidth: 1, padding: 10, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  join: { width: 46, fontSize: 13 },
  field: { flex: 1, minHeight: 44, borderWidth: 1, paddingHorizontal: 12, justifyContent: 'center' },
  fieldText: { fontSize: 14, fontWeight: '700' },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  is: { fontSize: 14 },
})
