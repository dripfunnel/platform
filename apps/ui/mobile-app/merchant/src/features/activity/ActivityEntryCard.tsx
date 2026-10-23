import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ActivityEntry } from '../../api/activity'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { locale, t, tryT } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { LinkButton } from '../common/LinkButton'
import { initialsOf } from '../shell/ShellHeader'
import { actorOf, doneOf, kindOf, nameOf, personOf } from './activityText'

type Props = {
  entry: ActivityEntry
  partner: string
  timeZone: string
  open: boolean
  onToggle: () => void
  /** Shows everything this person did; absent for an entry with no person to follow. */
  onPerson: (() => void) | null
  /** Opens what the entry is about, when it has a screen. */
  onOpenTarget: (() => void) | null
}

// One entry of the log (StoreActivity at phone width): who, what in words, Done / Refused / Failed and when; opened, its changes, reason,
// how it was done, "Everything by {name}" and a link to a product or an order.
export function ActivityEntryCard({ entry, partner, timeZone, open, onToggle, onPerson, onOpenTarget }: Props) {
  const { colors, radii } = useTheme()
  const actor = actorOf(entry)
  const result = { success: { fg: colors.success, bg: colors.successSurface }, denied: { fg: colors.danger, bg: colors.dangerSurface }, failed: { fg: colors.danger, bg: colors.dangerSurface } }[entry.result]
  const through = entry.through ? tryT(`activity.through.${entry.through.kind}`, { partner }) : undefined
  const onBehalf = entry.onBehalfOf && entry.actor.kind !== 'support_session' ? t('activity.onBehalf', { name: nameOf(entry.onBehalfOf.label) }) : null

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={t('activity.details', { text: `${actor} ${doneOf(entry)}` })} onPress={onToggle} style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: colors.infoSurface }]}>
          <Text style={[styles.avatarText, { color: colors.info }]}>{initialsOf(actor, '·')}</Text>
        </View>
        <View style={styles.text}>
          <Text style={[styles.what, { color: colors.text }]}>
            <Text style={styles.actor}>{actor}</Text> {doneOf(entry)}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{kindOf(entry.actor.kind, partner)}</Text>
          <View style={styles.meta}>
            <View style={[styles.pill, { backgroundColor: result.bg }]}>
              <Text style={[styles.pillText, { color: result.fg }]}>{t(`activity.results.${entry.result}`)}</Text>
            </View>
            <Text style={[styles.sub, { color: colors.muted }]}>{formatDateTime(entry.at, locale, timeZone)}</Text>
          </View>
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.panel, { borderTopColor: colors.border }]}>
          {entry.changes.map((change) => (
            <Text key={change.field} style={[styles.detail, { color: colors.textStrong }]}>
              {t('activity.change', { field: change.field, before: change.before ?? t('activity.blank'), after: change.after ?? t('activity.blank') })}
            </Text>
          ))}
          {entry.reason ? <Text style={[styles.detail, { color: colors.textStrong }]}>{t('activity.reason', { reason: entry.reason })}</Text> : null}
          {through ? <Text style={[styles.sub, { color: colors.muted }]}>{through}</Text> : null}
          {onBehalf ? <Text style={[styles.sub, { color: colors.muted }]}>{onBehalf}</Text> : null}
          {onPerson && personOf(entry) ? <LinkButton label={entry.actor.kind === 'support_session' ? t('activity.bySession') : t('activity.byPerson', { name: actor })} onPress={onPerson} /> : null}
          {onOpenTarget && entry.target?.label ? <LinkButton label={t('activity.open', { target: nameOf(entry.target.label) })} onPress={onOpenTarget} /> : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
  row: { minHeight: 64, flexDirection: 'row', gap: 12, padding: 14 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '800' },
  text: { flex: 1, gap: 2 },
  what: { fontSize: 14, lineHeight: 20 },
  actor: { fontWeight: '800' },
  sub: { fontSize: 12, lineHeight: 17 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 4 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  pillText: { fontSize: 12, fontWeight: '700' },
  panel: { borderTopWidth: 1, padding: 14, gap: 8 },
  detail: { fontSize: 13, lineHeight: 19 },
})
