import { useRouter } from 'expo-router'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBrand } from '../../brand/BrandProvider'
import { t, type MessageKey } from '../../messages'
import { moreFor, type MoreItem } from '../../nav'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useAccountActions } from './accountActions'
import { hasIcon, Icon } from './Icon'
import { initialsOf } from './ShellHeader'
import { useShell } from './ShellData'

const roleLabel = (role: string): string => (role.startsWith('supplier') ? t('auth.role.supplier') : t(`auth.role.${role}` as MessageKey))

// The partner's strings reach the system's URL opener, so only an https page or a plain address opens (a bad one is skipped).
const httpsPage = (url: string | null) => (url !== null && /^https:\/\/\S+$/i.test(url) ? url : null)
const mailAddress = (email: string | null) => (email !== null && /^[^\s@<>"?&#,;%]+@[^\s@<>"?&#,;%]+\.[^\s@<>"?&#,;%]+$/.test(email) ? `mailto:${email}` : null)

// The brand's own help page, then its support page, then a mail to its support address; none of them, no button.
export const helpTarget = (brand: { helpUrl: string | null; supportUrl: string | null; supportEmail: string | null } | null): string | null =>
  httpsPage(brand?.helpUrl ?? null) ?? httpsPage(brand?.supportUrl ?? null) ?? mailAddress(brand?.supportEmail ?? null)

export function MoreScreen() {
  const { colors, radii } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const actions = useAccountActions()
  const { brand } = useBrand()
  const { acting, seat, person } = useShell()
  const help = helpTarget(brand)

  const open = (item: MoreItem) => {
    if (item.kind === 'route') {
      if (item.href === '/profile') actions.openProfile()
      else router.push(item.href as never)
    } else if (item.action === 'switchStore') actions.switchStore()
    else actions.signOut()
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 96 + insets.bottom }]}>
        <View style={[styles.person, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          <View style={[styles.avatar, { backgroundColor: colors.brand }]}>
            <Text style={[styles.avatarText, { color: colors.brandContrast }]}>{initialsOf(person?.name ?? null, person?.email ?? '·')}</Text>
          </View>
          <View style={styles.personText}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.heading }]}>
              {person?.name ?? person?.email ?? ''}
            </Text>
            {person?.name ? (
              <Text numberOfLines={1} style={[styles.sub, { color: colors.muted }]}>
                {person.email}
              </Text>
            ) : null}
            <Text numberOfLines={1} style={[styles.sub, { color: colors.muted }]}>
              {t('shell.roleAt', { role: roleLabel(acting.role), store: acting.storeName })}
            </Text>
          </View>
        </View>

        {moreFor(seat).map((group) => (
          <View key={group.key} style={styles.group}>
            <Text accessibilityRole="header" style={[styles.groupTitle, { color: colors.muted }]}>
              {t(`more.group.${group.key}` as MessageKey)}
            </Text>
            <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
              {group.items.map((item, index) => {
                const danger = item.kind === 'action' && item.action === 'signOut'
                const label = t(`more.${item.key}` as MessageKey)
                const viewOnly = item.kind === 'route' && item.note === 'viewOnly'
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityLabel={viewOnly ? t('more.viewOnlyLabel', { item: label }) : label}
                    onPress={() => open(item)}
                    style={({ pressed }) => [styles.row, { borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : 1, backgroundColor: pressed ? colors.hover : 'transparent' }]}
                  >
                    {hasIcon(item.key) ? <Icon name={item.key} size={20} color={danger ? colors.danger : colors.heading} /> : <View style={styles.noIcon} />}
                    <Text style={[styles.rowLabel, { color: danger ? colors.danger : colors.text }]}>{label}</Text>
                    {viewOnly ? <Text style={[styles.note, { color: colors.muted }]}>{t('more.viewOnly')}</Text> : null}
                    {item.kind === 'route' ? <Icon name="chevron" size={18} color={colors.muted} /> : null}
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      {help ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('more.help')}
          onPress={() => void Linking.openURL(help)}
          style={[styles.help, { backgroundColor: colors.brand, shadowColor: colors.shadow, bottom: 16 + insets.bottom }]}
        >
          <Icon name="help" size={26} color={colors.brandContrast} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 18 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderWidth: 1 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 17, fontWeight: '800' },
  personText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13 },
  group: { gap: 8 },
  groupTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 4 },
  list: { borderWidth: 1, overflow: 'hidden' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16 },
  noIcon: { width: 20 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  note: { fontSize: 12 },
  help: { position: 'absolute', right: 16, width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
})
