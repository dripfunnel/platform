import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { LinkButton } from '../../common/LinkButton'
import { TextField } from '../../common/TextField'
import { ChoiceRow } from '../../common/ChoiceRow'
import { TextArea } from '../../common/TextArea'
import { PhotoSlot } from './PhotoSlot'
import { maxBoxItems, maxCompared, maxFeatures, maxGallery, type DraftModule } from './storyDraft'

type Change = (fix: (module: DraftModule) => DraftModule) => void

type Props = {
  module: DraftModule
  onChange: Change
  disabled: boolean
  /** The store's brand stories; null when they could not be read, empty for a supplier. */
  blocks: { id: string; name: string }[] | null
  supplier: boolean
  /** Product names by id, for the comparison's chips. */
  names: Record<string, string>
  /** What publishing said is still to fill in for this module. */
  gaps: ReadonlySet<string>
  onAddProducts: () => void
}

const sizes: Partial<Record<DraftModule['kind'], string>> = { banner: '1464 × 600', imageText: '970 × 600', gallery: '600 × 600', video: '1280 × 720' }

// A module's fields (CatAPlus's panel; CATALOG-DESIGN.md Q2): only those its kind has, each marked when publishing asked for it.
export function ModuleForm({ module, onChange, disabled, blocks, supplier, names, gaps, onAddProducts }: Props) {
  const { colors } = useTheme()
  const kind = module.kind
  const set = (patch: Partial<DraftModule>) => onChange((m) => ({ ...m, ...patch }))
  const hasTitle = kind !== 'brand'
  const marked = (field: string) => gaps.has(field)

  return (
    <View style={styles.form}>
      {hasTitle ? (
        <TextField
          label={t('products.story.title')}
          value={module.title}
          onChangeText={(title) => set({ title })}
          placeholder={t(`products.story.placeholders.${kind}`)}
          autoCapitalize="sentences"
          editable={!disabled}
          invalid={marked('title') && module.title.trim() === ''}
        />
      ) : null}

      {kind === 'imageText' ? <TextArea label={t('products.story.body')} value={module.body} onChangeText={(body) => set({ body })} placeholder={t('products.story.placeholders.text')} editable={!disabled} lines={3} /> : null}

      {kind === 'imageText' ? (
        <View style={styles.sides}>
          <Text style={[styles.label, { color: colors.text }]}>{t('products.story.side')}</Text>
          <ChoiceRow label={t('products.story.left')} selected={module.side === 'left'} disabled={disabled} onPress={() => set({ side: 'left' })} />
          <ChoiceRow label={t('products.story.right')} selected={module.side === 'right'} disabled={disabled} onPress={() => set({ side: 'right' })} />
        </View>
      ) : null}

      {kind === 'banner' || kind === 'imageText' ? (
        <PhotoSlot
          photo={module.photo}
          onChange={(photo) => set({ photo })}
          label={t('products.story.photo', { size: sizes[kind] ?? '' })}
          altLabel={t('products.story.alt')}
          disabled={disabled}
          marked={marked('photo') || marked('alt')}
        />
      ) : null}

      {kind === 'features' || kind === 'box' ? (
        <View style={styles.list}>
          <Text style={[styles.label, { color: colors.text }]}>{kind === 'features' ? t('products.story.items') : t('products.story.box')}</Text>
          {module.items.map((item, i) => (
            <View key={i} style={[styles.item, { borderColor: colors.border }]}>
              <TextField
                label={kind === 'features' ? t('products.story.itemTitle', { n: i + 1 }) : t('products.story.boxItem', { n: i + 1 })}
                value={item.title}
                onChangeText={(title) => set({ items: module.items.map((other, j) => (j === i ? { ...other, title } : other)) })}
                placeholder={t('products.story.placeholders.item')}
                autoCapitalize="sentences"
                editable={!disabled}
                invalid={marked('items') && item.title.trim() === ''}
              />
              {kind === 'features' ? (
                <>
                  <TextField label={t('products.story.itemText')} value={item.text} onChangeText={(text) => set({ items: module.items.map((other, j) => (j === i ? { ...other, text } : other)) })} autoCapitalize="sentences" editable={!disabled} />
                  <PhotoSlot
                    photo={item.photo}
                    onChange={(photo) => set({ items: module.items.map((other, j) => (j === i ? { ...other, photo } : other)) })}
                    label={t('products.story.itemPhoto')}
                    altLabel={t('products.story.alt')}
                    disabled={disabled}
                  />
                </>
              ) : null}
              {!disabled && module.items.length > 1 ? <LinkButton danger label={kind === 'features' ? t('products.story.itemRemove', { n: i + 1 }) : t('products.story.boxRemove', { n: i + 1 })} onPress={() => set({ items: module.items.filter((_, j) => j !== i) })} /> : null}
            </View>
          ))}
          {!disabled && module.items.length < (kind === 'features' ? maxFeatures : maxBoxItems) ? (
            <LinkButton label={kind === 'features' ? t('products.story.itemAdd') : t('products.story.boxAdd')} onPress={() => set({ items: [...module.items, { title: '', text: '', photo: { assetId: null, alt: '', localUri: null } }] })} />
          ) : null}
        </View>
      ) : null}

      {kind === 'gallery' ? (
        <View style={styles.list}>
          <Text style={[styles.label, { color: colors.text }]}>{t('products.story.gallery')}</Text>
          {module.photos.map((photo, i) => (
            <View key={i} style={[styles.item, { borderColor: colors.border }]}>
              <PhotoSlot
                photo={photo}
                onChange={(next) => set({ photos: module.photos.map((other, j) => (j === i ? next : other)) })}
                label={t('products.story.galleryPhoto', { n: i + 1 })}
                altLabel={t('products.story.galleryAlt', { n: i + 1 })}
                disabled={disabled}
                marked={marked('photo') || marked('alt')}
              />
              {!disabled ? <LinkButton danger label={t('products.story.galleryRemove', { n: i + 1 })} onPress={() => set({ photos: module.photos.filter((_, j) => j !== i) })} /> : null}
            </View>
          ))}
          {!disabled && module.photos.length < maxGallery ? <LinkButton label={t('products.story.galleryAdd')} onPress={() => set({ photos: [...module.photos, { assetId: null, alt: '', localUri: null }] })} /> : null}
        </View>
      ) : null}

      {kind === 'compare' ? (
        <View style={styles.list}>
          <Text style={[styles.label, { color: colors.text }]}>{t('products.story.compare')}</Text>
          <View style={styles.chips}>
            {module.productIds.map((id) => (
              <View key={id} style={[styles.chip, { borderColor: marked('products') ? colors.danger : colors.fieldBorder, backgroundColor: colors.surface }]}>
                <Text style={{ color: colors.text, fontSize: 14 }}>{names[id] ?? t('products.story.compareGone')}</Text>
                {!disabled ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('products.story.compareRemove', { name: names[id] ?? '' })} hitSlop={8} onPress={() => set({ productIds: module.productIds.filter((other) => other !== id) })}>
                    <Text style={{ color: colors.muted, fontSize: 16 }}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
          {!disabled && module.productIds.length < maxCompared ? <LinkButton label={t('products.story.compareSearch')} onPress={onAddProducts} /> : null}
          <Text style={[styles.note, { color: colors.muted }]}>{t('products.story.compareNote')}</Text>
        </View>
      ) : null}

      {kind === 'brand' ? (
        <View style={styles.list}>
          <Text style={[styles.label, { color: colors.text }]}>{t('products.story.brand')}</Text>
          {supplier ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.story.brandSupplier')}</Text> : null}
          {!supplier && blocks === null ? <Text style={[styles.note, { color: colors.danger }]}>{t('products.story.brandFailed')}</Text> : null}
          {!supplier && blocks?.length === 0 ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.story.brandEmpty')}</Text> : null}
          {blocks?.map((block) => (
            <ChoiceRow key={block.id} label={block.name} selected={module.blockId === block.id} disabled={disabled} onPress={() => set({ blockId: block.id })} />
          ))}
          {marked('block') ? <Text style={[styles.note, { color: colors.danger }]}>{t('products.story.gapFields.block')}</Text> : null}
        </View>
      ) : null}

      {kind === 'video' ? (
        <TextField
          label={t('products.story.video')}
          help={t('products.story.videoHint')}
          value={module.videoUrl}
          onChangeText={(videoUrl) => set({ videoUrl })}
          placeholder={t('products.story.videoPlaceholder')}
          keyboardType="url"
          editable={!disabled}
          invalid={marked('video') && module.videoUrl.trim() === ''}
        />
      ) : null}

      {kind === 'specs' || kind === 'faq' ? <Text style={[styles.note, { color: colors.muted }]}>{t('products.story.fromProduct', { what: kind === 'specs' ? t('products.story.fromSpecs') : t('products.story.fromFaqs') })}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  label: { fontSize: 14, fontWeight: '700' },
  sides: { gap: 8 },
  list: { gap: 10 },
  item: { gap: 10, borderBottomWidth: 1, paddingBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1 },
  note: { fontSize: 13, lineHeight: 19 },
})
