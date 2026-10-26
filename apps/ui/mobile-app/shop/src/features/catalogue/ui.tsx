import type { ReactNode } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import type { Loaded } from './useOperation'
import { errorKey } from './words'

// The few pieces every catalogue screen draws; the states are those of shop/FIRST-RELEASE.md §3 (empty, loading, error, offline).

export function Button({ label, onPress, kind = 'primary', disabled = false, busy = false }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; disabled?: boolean; busy?: boolean }) {
  const { colors, radii, controlHeight } = useTheme()
  const primary = kind === 'primary'
  const off = disabled || busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={[
        styles.button,
        { minHeight: controlHeight, borderRadius: radii.button },
        primary ? { backgroundColor: off ? colors.skeleton : colors.brand } : { borderWidth: 1, borderColor: colors.fieldBorder, backgroundColor: colors.surface },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? colors.brandContrast : colors.text} /> : <Text style={[styles.buttonLabel, { color: primary ? (off ? colors.muted : colors.brandContrast) : colors.text }]}>{label}</Text>}
    </Pressable>
  )
}

export function StateMessage({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="alert" style={styles.state}>
      <Text accessibilityRole="header" style={[styles.stateTitle, { color: colors.heading }]}>
        {title}
      </Text>
      <Text style={[styles.stateBody, { color: colors.muted }]}>{body}</Text>
      {actionLabel && onAction ? <Button kind="secondary" label={actionLabel} onPress={onAction} /> : null}
    </View>
  )
}

/** Shown above the last page the phone loaded, when it has no signal: writes still need a connection. */
export function OfflineBanner() {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder }]}>
      <Text style={{ color: colors.warning, fontWeight: '600', fontSize: 13 }}>{t('states.offline.banner')}</Text>
    </View>
  )
}

export function Skeleton({ kind }: { kind: 'grid' | 'detail' | 'list' }) {
  const { colors } = useTheme()
  const block = (key: number, style: object) => <View key={key} style={[{ backgroundColor: colors.skeleton, borderRadius: 10 }, style]} />
  const cards = [0, 1, 2, 3].map((n) => (
    <View key={n} style={styles.skeletonCard}>
      {block(0, { aspectRatio: 4 / 5 })}
      {block(1, { height: 12, width: '80%' })}
      {block(2, { height: 12, width: '45%' })}
    </View>
  ))
  return (
    <View accessibilityLabel={t('states.loading')} accessibilityRole="progressbar" style={styles.skeleton}>
      {kind === 'grid' ? <View style={styles.skeletonGrid}>{cards}</View> : null}
      {kind === 'detail' ? [block(0, { aspectRatio: 4 / 5, borderRadius: 0 }), block(1, { height: 22, width: '70%' }), block(2, { height: 16, width: '35%' }), block(3, { height: 44 })] : null}
      {kind === 'list' ? [0, 1, 2, 3].map((n) => block(n, { height: 72 })) : null}
    </View>
  )
}

/** One load, in whichever state it is in; `children` draws only the loaded data. */
export function Resource<T>({ state, onRetry, skeleton, children }: { state: Loaded<T>; onRetry: () => void; skeleton: 'grid' | 'detail' | 'list'; children: (data: T) => ReactNode }) {
  if (state.status === 'loading') return <Skeleton kind={skeleton} />
  if (state.status === 'error') return <StateMessage title={t('states.error.title')} body={t(errorKey(state.code))} actionLabel={t('states.retry')} onAction={onRetry} />
  if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} actionLabel={t('states.retry')} onAction={onRetry} />
  return (
    <>
      {state.stale ? <OfflineBanner /> : null}
      {children(state.data)}
    </>
  )
}

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.header, { paddingTop: insets.top, borderColor: colors.border, backgroundColor: colors.page }]}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={styles.back}>
          <Text style={[styles.backGlyph, { color: colors.heading }]}>‹</Text>
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: colors.heading }]}>
        {title}
      </Text>
    </View>
  )
}

/** A bottom sheet over the screen, closed by its button or a tap outside. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { colors, radii } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
        <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" onPress={onClose} style={styles.dismiss} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetHead}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.heading }]}>
              {title}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.close}>
              <Text style={{ color: colors.link, fontWeight: '700' }}>{t('common.close')}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonLabel: { fontWeight: '700', fontSize: 16 },
  state: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingVertical: 64 },
  stateTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  stateBody: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  banner: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  skeleton: { padding: 16, gap: 12 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  skeletonCard: { width: '47%', gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 4, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 32, lineHeight: 36 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', paddingHorizontal: 8 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { maxHeight: '85%', paddingTop: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 8, gap: 4 },
  sheetFooter: { paddingHorizontal: 16, paddingTop: 8 },
})
