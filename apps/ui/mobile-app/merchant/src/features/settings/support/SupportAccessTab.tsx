import { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadSupportAccess, setSupportAccess, type SupportAccess, type SupportSession } from '../../../api/settingsSupport'
import { loadStoreTimeZone } from '../../../api/storeInfo'
import { formatNumber } from '../../../format'
import type { ApiClient } from '../../../graphql'
import { useBrand } from '../../../brand/BrandContext'
import { locale, t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { FormSheet } from '../FormSheet'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { useWrite } from '../useWrite'
import { changesOf, whenOf, whoOf, whyOf } from './supportView'

// Settings › Support access (SetAccess "support"; ACCESS.md §8; FIRST-RELEASE (store) §15): the On/Off switch, how a session works, and the log.
export function SupportAccessTab() {
  return (
    <TabFrame
      label={t('settings.tabs.support')}
      load={async (client) => {
        const [access, timeZone] = await Promise.all([loadSupportAccess(client), loadStoreTimeZone(client).catch(() => null)])
        return { access, timeZone: timeZone ?? 'UTC' }
      }}
    >
      {({ data, client }) => <SupportBody initial={data.access} timeZone={data.timeZone} client={client} />}
    </TabFrame>
  )
}

const howLines = ['one', 'two', 'three', 'four', 'five'] as const

type Log = { sessions: readonly SupportSession[]; next: string | null }
const logOf = (access: SupportAccess): Log => ({ sessions: access.sessions.nodes, next: access.sessions.pageInfo.hasNextPage ? access.sessions.pageInfo.endCursor : null })

// The switch is a privacy control, so a read-only store may still change it (apps/api `whileReadOnly`); the tab's own gate is the Owner's.
function SupportBody({ initial, timeZone, client }: { initial: SupportAccess; timeZone: string; client: ApiClient }) {
  const { colors } = useTheme()
  const { brand } = useBrand()
  const partner = brand?.productName ?? t('brand.defaultName')
  const write = useWrite('settingsSupport')
  const [allowed, setAllowed] = useState(initial.allowed)
  const [log, setLog] = useState(logOf(initial))
  const [asking, setAsking] = useState(false)
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  const latest = useRef(0)
  const now = new Date()

  // The first page again after a switch, since turning it off ends open sessions. Only the newest read lands.
  const reread = async () => {
    const mine = ++latest.current
    try {
      const page = await loadSupportAccess(client)
      if (latest.current !== mine) return
      setAllowed(page.allowed)
      setLog(logOf(page))
      setOlder('idle')
    } catch {
      // The switch's own answer stands; the log keeps what it showed.
    }
  }

  const turn = async (to: boolean): Promise<string> => {
    const ended = await setSupportAccess(client, to)
    setAllowed(to)
    void reread()
    if (to) return t('settings.support.turnedOn')
    return ended > 0 ? tCount('settings.support.ended', ended, { total: formatNumber(ended, locale) }) : t('settings.support.turnedOff')
  }

  const showOlder = async (after: string) => {
    const mine = ++latest.current
    setOlder('loading')
    try {
      const page = await loadSupportAccess(client, after)
      if (latest.current !== mine) return
      setLog({ sessions: [...log.sessions, ...page.sessions.nodes], next: logOf(page).next })
      setOlder('idle')
    } catch {
      if (latest.current === mine) setOlder('failed')
    }
  }

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.support.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.support.sub', { partner })}</Text>
      </View>
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      <SectionCard title={t('settings.support.switch', { partner })} sub={allowed ? t('settings.support.on') : t('settings.support.off')}>
        <Switch label={allowed ? t('settings.support.onShort') : t('settings.support.offShort')} value={allowed} disabled={write.busy || older === 'loading'} onChange={(to) => (to ? void write.run(() => turn(true)) : setAsking(true))} />
      </SectionCard>
      <SectionCard title={t('settings.support.howTitle')}>
        {howLines.map((line) => (
          <Text key={line} style={[styles.text, { color: colors.text }]}>{`• ${t(`settings.support.how.${line}`)}`}</Text>
        ))}
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.support.staff')}</Text>
      </SectionCard>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.support.logTitle')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.support.logRange')}</Text>
      </View>
      {log.sessions.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.support.logEmpty', { partner })}</Text> : null}
      {log.sessions.map((session) => {
        const changes = changesOf(session, now)
        return <RowCard key={session.id} title={session.agentName} sub={[whoOf(session), whyOf(session), whenOf(session, now, timeZone)].join('\n')} status={changes.text} tone={changes.wrote ? 'wait' : 'plain'} />
      })}
      {older === 'failed' ? <Notice kind="error" text={t('settings.support.moreFailed')} /> : null}
      {log.next ? <Button kind="secondary" busy={older === 'loading'} label={t('settings.support.more')} onPress={() => void showOlder(log.next as string)} /> : null}

      {asking ? (
        <FormSheet
          title={t('settings.support.offTitle')}
          body={t('settings.support.offBody', { partner })}
          confirm={t('settings.support.offGo')}
          danger
          context="settingsSupport"
          onClose={() => setAsking(false)}
          onSubmit={() => turn(false)}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  text: { fontSize: 14, lineHeight: 21 },
})
