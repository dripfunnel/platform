import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { ProductPhoto } from '../ProductPhoto'
import { maxPhotos, type Draft, type DraftPhoto } from './draft'
import type { usePhotos } from './usePhotos'

type Props = { draft: Draft; update: (change: (draft: Draft) => Draft) => void; photos: ReturnType<typeof usePhotos>; disabled: boolean }

const move = (photos: DraftPhoto[], from: number, to: number): DraftPhoto[] => {
  if (to < 0 || to >= photos.length) return photos
  const next = [...photos]
  const [photo] = next.splice(from, 1)
  next.splice(to, 0, photo as DraftPhoto)
  return next
}

// Photos (CATALOG-DESIGN.md F1–F5): taken or picked on the phone, uploaded as they come, the first one the main photo. A photo's
// own menu makes it main, moves it, or removes it; there is no dragging on a phone.
export function PhotosCard({ draft, update, photos, disabled }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const main = draft.photos[0]
  const ready = draft.photos.filter((photo) => photo.status === 'ready')

  const openMenu = (photo: DraftPhoto, index: number) =>
    feedback.menu({
      title: t('products.photos.photoN', { n: index + 1 }),
      items: [
        ...(index > 0 ? [{ key: 'main', label: t('products.photos.makeMain'), onPress: () => update((d) => ({ ...d, photos: move(d.photos, index, 0) })) }] : []),
        ...(index > 0 ? [{ key: 'earlier', label: t('products.photos.moveEarlier'), onPress: () => update((d) => ({ ...d, photos: move(d.photos, index, index - 1) })) }] : []),
        ...(index < draft.photos.length - 1 ? [{ key: 'later', label: t('products.photos.moveLater'), onPress: () => update((d) => ({ ...d, photos: move(d.photos, index, index + 1) })) }] : []),
        { key: 'remove', label: t('products.photos.remove'), danger: true, onPress: () => update((d) => ({ ...d, photos: d.photos.filter((candidate) => candidate.key !== photo.key) })) },
      ],
    })

  return (
    <SectionCard title={t('products.photos.title')} sub={t('products.photos.meter', { count: draft.photos.length, limit: maxPhotos })}>
      <View style={styles.grid}>
        {draft.photos.map((photo, index) => (
          <View key={photo.key} style={styles.cell}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('products.photos.photoN', { n: index + 1 })}
              disabled={disabled || photo.status === 'uploading'}
              onPress={() => openMenu(photo, index)}
              style={[styles.thumb, { borderColor: index === 0 ? colors.heading : colors.border, borderWidth: index === 0 ? 2 : 1, borderRadius: radii.button }]}
            >
              <ProductPhoto path={photo.path} localUri={photo.localUri} size={96} label={photo.alt || t('products.photos.photoN', { n: index + 1 })} radius={radii.button} />
              {index === 0 && photo.status === 'ready' ? (
                <View style={[styles.badge, { backgroundColor: colors.heading }]}>
                  <Text style={[styles.badgeText, { color: colors.surface }]}>{t('products.photos.main')}</Text>
                </View>
              ) : null}
              {photo.status === 'uploading' ? (
                <View style={[styles.overlay, { backgroundColor: colors.backdrop }]}>
                  <Text style={[styles.overlayText, { color: colors.onInk }]}>{t('products.photos.uploading')}</Text>
                </View>
              ) : null}
              {photo.status === 'failed' ? (
                <View style={[styles.overlay, { backgroundColor: colors.dangerSurface }]}>
                  <Text style={[styles.failed, { color: colors.danger }]}>{t('products.photos.failed')}</Text>
                </View>
              ) : null}
            </Pressable>
            {photo.status === 'failed' ? (
              <View style={styles.failedActions}>
                <Text style={[styles.reason, { color: colors.danger }]}>{errorMessage(new ApiError(photo.code ?? undefined, 'upload'), 'products')}</Text>
                <Pressable accessibilityRole="button" onPress={() => photos.retry(photo.key)} style={styles.retry}>
                  <Text style={{ color: colors.link, fontWeight: '700', fontSize: 13 }}>{t('products.photos.retry')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => update((d) => ({ ...d, photos: d.photos.filter((candidate) => candidate.key !== photo.key) }))} style={styles.retry}>
                  <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>{t('products.photos.dismiss')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {!disabled && photos.room > 0 ? (
        <View style={styles.add}>
          <Button kind="secondary" label={t('products.photos.take')} onPress={() => void photos.fromCamera()} />
          <Button kind="secondary" label={draft.photos.length > 0 ? t('products.photos.addMore') : t('products.photos.choose')} onPress={() => void photos.fromLibrary()} />
        </View>
      ) : null}
      {photos.cameraDenied ? <Text style={[styles.help, { color: colors.danger }]}>{t('products.photos.cameraDenied')}</Text> : null}
      {!disabled && photos.room === 0 ? <Text style={[styles.help, { color: colors.muted }]}>{t('products.photos.limit')}</Text> : null}

      {ready.length > 0 && main ? (
        <TextField
          label={t('products.photos.altLabel')}
          help={t('products.photos.altHint')}
          value={main.alt}
          editable={!disabled}
          autoCapitalize="sentences"
          onChangeText={(alt) => update((d) => ({ ...d, photos: d.photos.map((photo, i) => (i === 0 ? { ...photo, alt } : photo)) }))}
        />
      ) : null}
      <Text style={[styles.help, { color: colors.muted }]}>{ready.length > 0 ? t('products.photos.help') : t('products.photos.helpNone')}</Text>
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: 96, gap: 4 },
  thumb: { width: 96, height: 96, overflow: 'hidden' },
  badge: { position: 'absolute', left: 4, top: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 4 },
  overlayText: { fontSize: 12, fontWeight: '600' },
  failed: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  failedActions: { gap: 0 },
  reason: { fontSize: 11, lineHeight: 15 },
  retry: { minHeight: 44, justifyContent: 'center' },
  add: { gap: 8 },
  help: { fontSize: 13, lineHeight: 19 },
})
