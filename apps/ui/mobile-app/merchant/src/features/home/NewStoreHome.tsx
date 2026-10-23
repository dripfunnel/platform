import { StyleSheet, Text, View } from 'react-native'
import type { LocaleFacts, StoreHome } from '../../api/home'
import type { Seat } from '../../nav'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { dateLineOf, greetingOf, needsOf, setupOf } from './homeView'
import { NeedsYou } from './NeedsYou'
import { SetupChecklist } from './SetupChecklist'

type Props = { home: StoreHome; name: string | null; storeName: string; seat: Seat | null; canSettings: boolean; facts: LocaleFacts | null; onOpen: (href: string) => void }

// Home for a store with no order and no product the seat knows of (`PortalHome`, DESIGN.md §3): the greeting, what waits, and the checklist.
// Staff are told the shop is still being set up, and a Manager that payments and shipping are the owner's.
export function NewStoreHome({ home, name, storeName, seat, canSettings, facts, onOpen }: Props) {
  const { colors, radii } = useTheme()
  const now = new Date()
  const needs = needsOf(home)
  const items = setupOf(home, facts, canSettings, seat)
  return (
    <View style={styles.screen}>
      <View style={styles.greeting}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {greetingOf(name, home.timeZone, now)}
        </Text>
        <Text style={[styles.date, { color: colors.muted }]}>{dateLineOf(storeName, home.timeZone, now)}</Text>
      </View>

      {needs.length > 0 ? <NeedsYou needs={needs} onOpen={onOpen} /> : null}

      {items.length > 0 ? <SetupChecklist items={items} onOpen={onOpen} /> : null}
      {items.length > 0 && !canSettings ? <Text style={[styles.date, { color: colors.textStrong }]}>{t('home.ownerNote')}</Text> : null}

      {items.length === 0 ? (
        <View style={[styles.wait, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          <Text accessibilityRole="header" style={[styles.waitTitle, { color: colors.heading }]}>
            {t('home.staffWait.title')}
          </Text>
          <Text style={[styles.date, { color: colors.muted }]}>{t('home.staffWait.body')}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { padding: 14, paddingBottom: 28, gap: 18 },
  greeting: { gap: 2 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  date: { fontSize: 14, lineHeight: 20 },
  wait: { borderWidth: 1, padding: 18, gap: 4 },
  waitTitle: { fontSize: 16, fontWeight: '800' },
})
