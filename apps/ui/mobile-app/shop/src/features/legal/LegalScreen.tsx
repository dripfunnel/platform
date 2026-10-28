import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { ScreenHeader } from '../common/ui'
import { useOnline } from '@dripfunnel/mobile-shared/connection'
import { policies } from './policies'
import { useOpenPolicy } from './useOpenPolicy'

/** The store's legal pages, each opened in the in-app browser from the storefront (shop/FIRST-RELEASE.md §2). A page is the website's, so it needs a connection. */
export function LegalScreen() {
  const router = useRouter()
  const { host } = useShop()
  const { colors, radii } = useTheme()
  const online = useOnline()
  const { open, failed } = useOpenPolicy()
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t('legal.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account'))} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          {policies.map(({ kind, title }, index) => (
            <Pressable
              key={kind}
              accessibilityRole="link"
              accessibilityLabel={t(title)}
              accessibilityHint={online ? undefined : t('states.offline.opens')}
              accessibilityState={{ disabled: !online }}
              disabled={!online}
              onPress={() => void open(kind)}
              style={[styles.row, { borderTopWidth: index ? 1 : 0, borderColor: colors.border, opacity: online ? 1 : 0.5 }]}
            >
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{t(title)}</Text>
              <Text style={{ color: colors.muted, fontSize: 18 }}>›</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{t('legal.note', { host })}</Text>
        {failed ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
            {t('legal.failed')}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 12, padding: 16, paddingBottom: 40 },
  list: { borderWidth: 1, overflow: 'hidden' },
  row: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
})
