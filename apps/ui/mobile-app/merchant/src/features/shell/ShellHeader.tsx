import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { useAccountActions } from './accountActions'
import { useFeedback } from './Feedback'
import { Icon } from './Icon'
import { useShell } from './ShellData'

export const initialsOf = (name: string | null, fallback: string): string => {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? `${words[0]?.[0] ?? ''}${words[words.length - 1]?.[0] ?? ''}` : (words[0] ?? fallback).slice(0, 2)
  return letters.toLocaleUpperCase()
}

// The header in the partner's colour (DESIGN.md §2): at a tab's root the store (tap to switch) and the avatar; deeper,
// a back button instead of the store. It paints under the status bar, so the bar takes the same colour.
export function ShellHeader({ deep }: { deep: boolean }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const feedback = useFeedback()
  const actions = useAccountActions()
  const { acting, person } = useShell()

  const openAccount = () =>
    feedback.menu({
      title: person?.name ?? person?.email ?? t('shell.account'),
      ...(person?.name ? { sub: person.email } : {}),
      items: [
        { key: 'profile', label: t('shell.myProfile'), onPress: actions.openProfile },
        { key: 'switchStore', label: t('shell.switchStore'), onPress: actions.switchStore },
        { key: 'signOut', label: t('shell.signOut'), danger: true, onPress: actions.signOut },
      ],
    })

  return (
    <View style={[styles.header, { backgroundColor: colors.side, paddingTop: insets.top + 2 }]}>
      {deep ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <Icon name="back" size={24} color={colors.sideText} strokeWidth={2.2} />
          <Text style={[styles.backLabel, { color: colors.sideText }]}>{t('common.back')}</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={t('shell.switchStoreFrom', { store: acting.storeName })} onPress={actions.switchStore} style={styles.store}>
          <View style={styles.tile}>
            <View style={[StyleSheet.absoluteFill, styles.tileFill, { backgroundColor: colors.sideText }]} />
            <Text style={[styles.tileText, { color: colors.sideText }]}>{initialsOf(acting.storeName, '·').slice(0, 1)}</Text>
          </View>
          <Text numberOfLines={1} style={[styles.storeName, { color: colors.sideText }]}>
            {acting.storeName}
          </Text>
          <Text style={[styles.caret, { color: colors.sideText }]}>{t('shell.caret')}</Text>
        </Pressable>
      )}
      <View style={styles.spacer} />
      <Pressable accessibilityRole="button" accessibilityLabel={t('shell.account')} onPress={openAccount} style={styles.avatarHit}>
        <View style={[styles.avatar, { backgroundColor: colors.brand }]}>
          <Text style={[styles.avatarText, { color: colors.brandContrast }]}>{initialsOf(person?.name ?? null, person?.email ?? '·')}</Text>
        </View>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingBottom: 8 },
  back: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 10 },
  backLabel: { fontSize: 16, fontWeight: '600' },
  store: { flexShrink: 1, height: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6 },
  tile: { width: 32, height: 32, borderRadius: 9, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tileFill: { opacity: 0.16 },
  tileText: { fontSize: 13, fontWeight: '800' },
  storeName: { flexShrink: 1, fontSize: 17, fontWeight: '800' },
  caret: { fontSize: 11 },
  spacer: { flex: 1 },
  avatarHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '800' },
})
