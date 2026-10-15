import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Icon } from '../shell/Icon'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { settingsAccess } from './access'
import { settingsTabHref } from './routes'
import { settingsTabs } from './tabs'

// Settings (PortalSettings at phone width; FIRST-RELEASE (store) §15): the Owner's seven tabs as a list of rows, each opening on its own screen.
// Anyone else is told so and nothing is read.
export function SettingsScreen() {
  const { colors, radii } = useTheme()
  const router = useRouter()
  const { seat, state } = useShell()
  const { allowed } = settingsAccess(seat, state?.readOnly === true)

  return (
    <ShellScreen label={t('settings.screen')} {...(allowed ? {} : { state: 'denied' as const })}>
      <View style={styles.content}>
        <Text style={[styles.intro, { color: colors.muted }]}>{t('settings.intro')}</Text>
        <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          {settingsTabs.map((tab, index) => (
            <Pressable
              key={tab}
              accessibilityRole="button"
              accessibilityLabel={t(`settings.tabs.${tab}`)}
              onPress={() => router.push(settingsTabHref(tab) as never)}
              style={({ pressed }) => [styles.row, { borderTopColor: colors.border, borderTopWidth: index === 0 ? 0 : 1, backgroundColor: pressed ? colors.hover : 'transparent' }]}
            >
              <View style={styles.text}>
                <Text style={[styles.label, { color: colors.text }]}>{t(`settings.tabs.${tab}`)}</Text>
                <Text style={[styles.sub, { color: colors.muted }]}>{t(`settings.tabSubs.${tab}`)}</Text>
              </View>
              <Icon name="chevron" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      </View>
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  intro: { fontSize: 14, paddingHorizontal: 4 },
  list: { borderWidth: 1, overflow: 'hidden' },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18 },
})
