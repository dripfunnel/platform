import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import { languageLabel } from '../markets/labels'
import { useMarkets } from '../markets/MarketsContext'

/** What Account offers whether or not anyone is signed in: the store's language and currency, and its legal pages. */
export function AccountLinks() {
  const router = useRouter()
  const { colors, radii } = useTheme()
  const { offers, choice } = useMarkets()
  const current = offers ? [languageLabel(choice.language ?? offers.languages[0] ?? ''), choice.currency ?? offers.currencies[0]].filter(Boolean).join(' · ') : null
  const rows = [
    { title: t('markets.title'), body: current, to: '/account/markets' },
    { title: t('legal.title'), body: t('legal.rowBody'), to: '/account/legal' },
  ] as const
  return (
    <>
      {rows.map(({ title, body, to }) => (
        <Pressable
          key={to}
          accessibilityRole="button"
          accessibilityLabel={body ? `${title}, ${body}` : title}
          onPress={() => router.push(to)}
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
        >
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
          {body ? <Text style={{ color: colors.muted, fontSize: 14 }}>{body}</Text> : null}
        </Pressable>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: 64, justifyContent: 'center', gap: 2, paddingHorizontal: 14, borderWidth: 1 },
})
