import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { activityWhats } from '../../api/activity'
import { useBrand } from '../../brand/BrandContext'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { Chip } from '../common/Chip'
import { LinkButton } from '../common/LinkButton'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { ListMessage } from '../orders/ListMessage'
import { PickerField } from '../settings/PickerField'
import { useShell } from '../shell/ShellData'
import { kindOf, personOf, targetHref, whoseOf } from './activityText'
import { ActivityEntryCard } from './ActivityEntryCard'
import { ActivityExportStatus } from './ActivityExportStatus'
import { useActivityExport } from './useActivityExport'
import { useActivityLog } from './useActivityLog'

type Props = {
  /** "Activity log" in the Owner's Settings, "Store activity" for a Manager. */
  title: string
  client: ApiClient
  timeZone: string
  /** `activity.export`, the Owner's alone: anyone else sees the button disabled with the reason. */
  canExport: boolean
}

const everyone = ''
const keyOf = (person: { kind: string; id: string }): string => `${person.kind}:${person.id}`

// The store's activity log (StoreActivity at phone width; FIRST-RELEASE (store) §15, LOGGING.md §6–7): filter by person, what and words, newest first, 50 a page.
// The Owner's Settings tab and the Manager's Store activity are this one view.
export function ActivityView({ title, client, timeZone, canExport }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const { brand } = useBrand()
  const { seat } = useShell()
  const partner = brand?.productName ?? t('brand.defaultName')
  const log = useActivityLog(client)
  const exported = useActivityExport(client)
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ key: string; name: string } | null>(null)
  const [exportFailure, setExportFailure] = useState<string | null>(null)

  // The person list offers who appears in what is loaded, and whoever is picked: no API lists the log's people, and a name never rides in a filter.
  const people = useMemo(() => {
    const seen = new Map<string, string>()
    for (const entry of log.entries) {
      const person = personOf(entry)
      if (person) seen.set(keyOf(person), `${whoseOf(entry)} · ${kindOf(entry.actor.kind, partner)}`)
    }
    if (picked && !seen.has(picked.key)) seen.set(picked.key, picked.name)
    return [...seen].map(([value, label]) => ({ value, label }))
  }, [log.entries, partner, picked])
  const personKey = log.person ? keyOf(log.person) : everyone
  const personName = people.find((person) => person.value === personKey)?.label ?? t('activity.thisPerson')

  const follow = (person: { kind: string; id: string } | null, name: string) => {
    setPicked(person ? { key: keyOf(person), name } : null)
    log.setPerson(person)
    setOpen(null)
  }

  const startExport = () => {
    setExportFailure(null)
    exported.begin(log.filter).catch((error: unknown) => setExportFailure(errorMessage(error, 'activity')))
  }

  const exportNotice = exportFailure ?? (exported.error !== null ? errorMessage(exported.error, 'activity') : null)

  const filtered = log.person !== null || log.what !== null || log.filter.search !== ''
  const body = () => {
    if (log.status === 'loading') return <Text style={[styles.sub, { color: colors.muted }]}>{t('activity.loading')}</Text>
    if (log.status === 'error') {
      const denied = isApiError(log.error, 'FORBIDDEN')
      return (
        <ListMessage title={denied ? t('activity.denied.title') : t('activity.error.title')} body={denied ? t('activity.denied.body') : t('activity.error.body')}>
          {denied ? null : <Button kind="secondary" label={t('common.tryAgain')} onPress={log.reload} />}
        </ListMessage>
      )
    }
    if (log.entries.length === 0) return <ListMessage title={filtered ? t('activity.none') : t('activity.empty')} body={filtered ? t('activity.noneBody') : t('activity.emptyBody')} />
    return (
      <>
        {log.entries.map((entry) => {
          const person = personOf(entry)
          const href = targetHref(entry, seat)
          return (
            <ActivityEntryCard
              key={entry.id}
              entry={entry}
              partner={partner}
              timeZone={timeZone}
              open={open === entry.id}
              onToggle={() => setOpen(open === entry.id ? null : entry.id)}
              onPerson={person ? () => follow(person, `${whoseOf(entry)} · ${kindOf(entry.actor.kind, partner)}`) : null}
              onOpenTarget={href ? () => router.push(href as never) : null}
            />
          )
        })}
        {log.moreFailed ? <Notice kind="error" text={t('activity.moreFailed')} /> : null}
        {log.hasMore ? <Button kind="secondary" busy={log.loadingMore} label={t('activity.more')} onPress={log.showOlder} /> : <Text style={[styles.sub, styles.foot, { color: colors.muted }]}>{t('activity.foot')}</Text>}
      </>
    )
  }

  return (
    <View style={styles.view}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {title}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('activity.sub')}</Text>
      </View>
      {canExport ? (
        <Button kind="secondary" saves busy={exported.busy} label={t('activity.exportCsv')} onPress={startExport} />
      ) : (
        <>
          <Button kind="secondary" disabled label={t('activity.exportCsv')} onPress={() => undefined} />
          <Text style={[styles.sub, { color: colors.muted }]}>{t('activity.exportOwner')}</Text>
        </>
      )}
      {exportNotice !== null ? <Notice kind="error" text={exportNotice} /> : null}
      {exported.job && exported.error === null ? <ActivityExportStatus job={exported.job} onShare={() => void exported.share(exported.job as NonNullable<typeof exported.job>)} /> : null}
      <PickerField
        label={t('activity.person')}
        value={personKey}
        options={[{ value: everyone, label: t('activity.everyone') }, ...people]}
        onChange={(key) => {
          const found = people.find((person) => person.value === key)
          const [kind = '', ...id] = key.split(':')
          follow(found ? { kind, id: id.join(':') } : null, found?.label ?? '')
        }}
      />
      {log.person ? (
        <View style={styles.personLine}>
          <Text style={[styles.sub, styles.grow, { color: colors.muted }]}>{t('activity.showing', { name: personName })}</Text>
          <LinkButton label={t('activity.clearPerson')} onPress={() => follow(null, '')} />
        </View>
      ) : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={t('activity.what')} style={styles.chips}>
        <Chip label={t('activity.whats.all')} selected={log.what === null} onPress={() => log.setWhat(null)} />
        {activityWhats.map((what) => (
          <Chip key={what} label={t(`activity.whats.${what}`)} selected={log.what === what} onPress={() => log.setWhat(what)} />
        ))}
      </View>
      <TextField label={t('activity.search')} value={log.search} onChangeText={log.setSearch} placeholder={t('activity.searchPlaceholder')} returnKeyType="search" />
      {body()}
    </View>
  )
}

const styles = StyleSheet.create({
  view: { gap: 12 },
  head: { gap: 2 },
  title: { fontSize: 19, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  grow: { flex: 1 },
  foot: { textAlign: 'center' },
  personLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
