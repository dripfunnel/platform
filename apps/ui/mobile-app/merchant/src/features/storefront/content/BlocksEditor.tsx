import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { blockKinds, contentLimits, type BlockKind } from '../../../api/storefrontContent'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { TextField } from '../../common/TextField'
import { ProductPicker } from '../../products/story/ProductPicker'
import { moveBlock, newBlock, type DraftBlock } from './contentDraft'

type Props = {
  client: ApiClient
  body: DraftBlock[]
  /** Each change is made to the blocks as they are then. */
  onBody: (change: (was: DraftBlock[]) => DraftBlock[]) => void
  canEdit: boolean
  /** Product names by id: null for one no longer in the catalogue, absent while unknown. */
  names: Record<string, string | null>
  /** The names could not be read, so a product still unknown is shown as such. */
  namesFailed: boolean
  onName: (id: string, name: string) => void
}

// A photo is not added on the phone (decided on #513); one the post already has stays, moves and can be removed.
const addable = blockKinds.filter((kind): kind is Exclude<BlockKind, 'image'> => kind !== 'image')

// The post's blocks (StorefrontContent's block editor at phone width): add, move, remove and fill each kind.
export function BlocksEditor({ client, body, onBody, canEdit, names, namesFailed, onName }: Props) {
  const { colors, radii } = useTheme()
  const [picking, setPicking] = useState<number | null>(null)
  const set = (index: number, patch: Partial<DraftBlock>) => onBody((was) => was.map((block, i) => (i === index ? { ...block, ...patch } : block)))
  const full = body.length >= contentLimits.blocks

  return (
    <View style={styles.list}>
      {body.map((block, index) => {
        const number = index + 1
        const label = t('storefront.content.editor.blockText', { kind: t(`storefront.content.editor.kinds.${block.kind}`), number })
        return (
          <View key={block.key} style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
            <Text accessibilityRole="header" style={[styles.kind, { color: colors.muted }]}>
              {label}
            </Text>
            {block.kind === 'heading' ? <TextField label={label} value={block.text} onChangeText={(text) => set(index, { text })} editable={canEdit} maxLength={contentLimits.title} autoCapitalize="sentences" /> : null}
            {block.kind === 'text' ? (
              <TextInput
                accessibilityLabel={label}
                value={block.text}
                onChangeText={(text) => set(index, { text })}
                editable={canEdit}
                multiline
                maxLength={contentLimits.text}
                placeholderTextColor={colors.muted}
                style={[styles.text, { color: colors.text, borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}
              />
            ) : null}
            {block.kind === 'image' ? <Text style={[styles.note, { color: colors.muted }]}>{t('storefront.content.editor.photoKept')}</Text> : null}
            {block.kind === 'faq' ? (
              <View style={styles.list}>
                {block.items.map((item, q) => (
                  <View key={q} style={styles.question}>
                    <TextField label={t('storefront.content.editor.question', { number: q + 1 })} value={item.question} onChangeText={(question) => set(index, { items: block.items.map((own, i) => (i === q ? { ...own, question } : own)) })} editable={canEdit} maxLength={contentLimits.question} autoCapitalize="sentences" />
                    <TextField label={t('storefront.content.editor.answer', { number: q + 1 })} value={item.answer} onChangeText={(answer) => set(index, { items: block.items.map((own, i) => (i === q ? { ...own, answer } : own)) })} editable={canEdit} maxLength={contentLimits.answer} autoCapitalize="sentences" />
                    {canEdit ? <Button kind="secondary" label={t('storefront.content.editor.removeQuestion', { number: q + 1 })} onPress={() => set(index, { items: block.items.filter((_, i) => i !== q) })} /> : null}
                  </View>
                ))}
                {canEdit && block.items.length < contentLimits.questions ? <Button kind="secondary" label={t('storefront.content.editor.addQuestion')} onPress={() => set(index, { items: [...block.items, { question: '', answer: '' }] })} /> : null}
              </View>
            ) : null}
            {block.kind === 'products' ? (
              <View style={styles.list}>
                <Text style={[styles.note, { color: colors.muted }]}>{t('storefront.content.editor.productsHelp')}</Text>
                {namesFailed ? <Text style={[styles.note, { color: colors.danger }]}>{t('storefront.content.editor.namesFailed')}</Text> : null}
                {block.productIds.map((id) => {
                  const name = names[id]
                  const shown = typeof name === 'string' ? name : id in names ? t('storefront.content.editor.goneProduct') : t('storefront.content.editor.unknownProduct')
                  return (
                    <View key={id} style={styles.productRow}>
                      <Text style={[styles.productName, { color: colors.text }]}>{shown}</Text>
                      {canEdit ? <Button kind="secondary" label={t('storefront.content.editor.removeProduct', { name: shown })} onPress={() => set(index, { productIds: block.productIds.filter((own) => own !== id) })} /> : null}
                    </View>
                  )
                })}
                {canEdit && block.productIds.length < contentLimits.products ? <Button kind="secondary" label={t('storefront.content.editor.findProduct')} onPress={() => setPicking(index)} /> : null}
              </View>
            ) : null}
            {canEdit ? (
              <View style={styles.controls}>
                <Control accessibilityLabel={t('storefront.content.editor.moveUp', { number })} text="↑" disabled={index === 0} onPress={() => onBody((was) => moveBlock(was, index, -1))} />
                <Control accessibilityLabel={t('storefront.content.editor.moveDown', { number })} text="↓" disabled={index === body.length - 1} onPress={() => onBody((was) => moveBlock(was, index, 1))} />
                <Control accessibilityLabel={t('storefront.content.editor.remove', { number })} text="✕" onPress={() => onBody((was) => was.filter((_, i) => i !== index))} />
              </View>
            ) : null}
          </View>
        )
      })}
      {canEdit ? (
        <View style={styles.tools} accessibilityLabel={t('storefront.content.editor.toolsLabel')}>
          {addable.map((tool) => (
            <Button key={tool} kind="secondary" label={t(`storefront.content.editor.tools.${tool}`)} disabled={full} onPress={() => onBody((was) => [...was, newBlock(tool)])} />
          ))}
        </View>
      ) : null}
      {picking !== null ? (
        <ProductPicker
          client={client}
          title={t('storefront.content.editor.findProduct')}
          max={contentLimits.products}
          exclude={[]}
          chosen={body[picking]?.productIds ?? []}
          onPick={(picked) => {
            picked.forEach((product) => onName(product.id, product.name))
            set(picking, { productIds: [...(body[picking]?.productIds ?? []), ...picked.map((product) => product.id)].slice(0, contentLimits.products) })
            setPicking(null)
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </View>
  )
}

function Control({ accessibilityLabel, text, disabled = false, onPress }: { accessibilityLabel: string; text: string; disabled?: boolean; onPress: () => void }) {
  const { colors, radii } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.control, { borderColor: colors.fieldBorder, borderRadius: radii.button, opacity: disabled ? 0.4 : 1 }]}>
      <Text style={[styles.controlText, { color: colors.text }]}>{text}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  block: { borderWidth: 1, padding: 14, gap: 10 },
  kind: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  text: { borderWidth: 1.5, minHeight: 120, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, textAlignVertical: 'top' },
  note: { fontSize: 13, lineHeight: 19 },
  question: { gap: 10 },
  productRow: { gap: 8 },
  productName: { fontSize: 15, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: 8 },
  control: { minWidth: 44, height: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  controlText: { fontSize: 18, fontWeight: '700' },
  tools: { gap: 8 },
})
