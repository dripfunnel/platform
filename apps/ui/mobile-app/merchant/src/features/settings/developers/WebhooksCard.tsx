import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { addWebhook, loadDeliveries, replayDelivery, turnOnWebhook, type WebhookDelivery, type WebhookEndpoint } from '../../../api/settingsDevelopers'
import { formatDateTime, formatNumber } from '../../../format'
import type { ApiClient } from '../../../graphql'
import { locale, t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { FormSheet } from '../FormSheet'
import { useWrite } from '../useWrite'
import { durationOf, hookState, outcomeOf } from './developersView'
import type { Secret } from './SecretCard'

type Props = {
  hooks: readonly WebhookEndpoint[]
  events: readonly string[]
  timeZone: string
  client: ApiClient
  canEdit: boolean
  secretShown: boolean
  onSecret: (secret: Secret) => void
  reload: () => Promise<void>
}

// Developers › Webhooks (SetDev; FIRST-RELEASE (store) §15): each endpoint with its events and state, its latest deliveries and "Send again".
// Editing or removing an endpoint is not drawn (SetDev draws neither).
export function WebhooksCard({ hooks, events, timeZone, client, canEdit, secretShown, onSecret, reload }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.developers.hooks.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.developers.hooks.sub')}</Text>
        {canEdit ? <Button saves label={t('settings.developers.hooks.add')} onPress={() => (secretShown ? feedback.toast({ message: t('settings.developers.hooks.storeFirst') }) : setAdding(true))} /> : null}
      </View>
      {hooks.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.developers.hooks.empty')}</Text> : null}
      {hooks.map((hook) => (
        <EndpointCard key={hook.id} hook={hook} timeZone={timeZone} client={client} canEdit={canEdit} reload={reload} />
      ))}
      {adding ? <AddEndpointSheet events={events} client={client} onClose={() => setAdding(false)} onSecret={onSecret} reload={reload} /> : null}
    </>
  )
}

type EndpointProps = { hook: WebhookEndpoint; timeZone: string; client: ApiClient; canEdit: boolean; reload: () => Promise<void> }

type Log = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: readonly WebhookDelivery[] }

function EndpointCard({ hook, timeZone, client, canEdit, reload }: EndpointProps) {
  const { colors } = useTheme()
  const write = useWrite('settingsDevelopers')
  const [log, setLog] = useState<Log | null>(null)
  const asked = useRef(0)
  const state = hookState(hook, timeZone)
  const tone = state.tone === 'ok' ? colors.success : state.tone === 'wait' ? colors.warning : colors.danger

  // Only the newest opening lands: a slow answer to an earlier one is dropped.
  const readLog = async () => {
    const mine = ++asked.current
    setLog({ status: 'loading' })
    try {
      const rows = await loadDeliveries(client, hook.id)
      if (asked.current === mine) setLog({ status: 'ready', rows })
    } catch {
      if (asked.current === mine) setLog({ status: 'error' })
    }
  }

  return (
    <SectionCard title={hook.url} sub={hook.events.join(' · ')}>
      <Text style={[styles.status, { color: tone }]}>{state.status}</Text>
      {state.line ? <Notice text={state.line} /> : null}
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      {hook.status === 'disabled' && canEdit ? (
        <Button
          saves
          busy={write.busy}
          kind="secondary"
          label={t('settings.developers.hooks.turnOn')}
          onPress={() =>
            void write.run(async () => {
              const sent = await turnOnWebhook(client, hook.id)
              await reload()
              return sent > 0 ? tCount('settings.developers.hooks.turnedOn', sent, { total: formatNumber(sent, locale) }) : t('settings.developers.hooks.turnedOnNone')
            })
          }
        />
      ) : null}
      <Button kind="secondary" label={log ? t('settings.developers.hooks.hideLog') : t('settings.developers.hooks.showLog')} onPress={() => (log ? setLog(null) : void readLog())} />
      {log?.status === 'loading' ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.developers.hooks.logLoading')}</Text> : null}
      {log?.status === 'error' ? <Notice kind="error" text={t('settings.developers.hooks.logFailed')} /> : null}
      {log?.status === 'ready' && log.rows.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.developers.hooks.logEmpty')}</Text> : null}
      {log?.status === 'ready'
        ? log.rows.map((delivery) => {
            const outcome = outcomeOf(delivery)
            const took = durationOf(delivery.durationMs)
            return (
              <View key={delivery.id} style={[styles.delivery, { borderTopColor: colors.border }]}>
                <View style={styles.deliveryText}>
                  <Text style={[styles.event, { color: colors.text }]}>{delivery.event}</Text>
                  <Text style={[styles.sub, { color: colors.muted }]}>{formatDateTime(delivery.createdAt, locale, timeZone)}</Text>
                  <Text style={[styles.outcome, { color: outcome.failed ? colors.danger : colors.success }]}>{took ? `${outcome.text} · ${took}` : outcome.text}</Text>
                </View>
                {canEdit ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.developers.hooks.replayName', { event: delivery.event })}
                    disabled={write.busy}
                    onPress={() =>
                      void write.run(async () => {
                        await replayDelivery(client, delivery.id)
                        return t('settings.developers.hooks.replayed', { event: delivery.event })
                      })
                    }
                    style={styles.replay}
                  >
                    <Text style={[styles.replayText, { color: colors.link }]}>{t('settings.developers.hooks.replay')}</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          })
        : null}
    </SectionCard>
  )
}

type AddProps = { events: readonly string[]; client: ApiClient; onClose: () => void; onSecret: (secret: Secret) => void; reload: () => Promise<void> }

function AddEndpointSheet({ events, client, onClose, onSecret, reload }: AddProps) {
  const { colors } = useTheme()
  const [url, setUrl] = useState('')
  const [picked, setPicked] = useState<readonly string[]>([])
  const [tried, setTried] = useState(false)
  const https = /^https:\/\/\S+$/i.test(url.trim())

  return (
    <FormSheet
      title={t('settings.developers.hooks.add')}
      confirm={t('settings.developers.hooks.add')}
      context="settingsDevelopers"
      onClose={onClose}
      check={() => {
        setTried(true)
        if (!https) return t('settings.developers.hooks.notHttps')
        return picked.length === 0 ? t('settings.developers.hooks.eventsMissing') : null
      }}
      onSubmit={async () => {
        const saved = await addWebhook(client, url.trim(), picked)
        if (saved.secret) onSecret({ title: t('settings.developers.hooks.secretTitle'), warning: t('settings.developers.hooks.secretWarn'), value: saved.secret })
        await reload()
        return t('settings.developers.hooks.added')
      }}
    >
      <TextField label={t('settings.developers.hooks.url')} value={url} onChangeText={setUrl} placeholder={t('settings.developers.hooks.urlPlaceholder')} keyboardType="url" autoComplete="off" invalid={tried && !https} />
      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('settings.developers.hooks.events')}</Text>
        <View style={styles.chips}>
          {events.map((event) => (
            <Chip key={event} label={event} selected={picked.includes(event)} onPress={() => setPicked(picked.includes(event) ? picked.filter((other) => other !== event) : [...picked, event])} />
          ))}
        </View>
      </View>
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  status: { fontSize: 13, fontWeight: '800' },
  delivery: { borderTopWidth: 1, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  deliveryText: { flex: 1, gap: 2 },
  event: { fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  outcome: { fontSize: 13, fontWeight: '700' },
  replay: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 4 },
  replayText: { fontSize: 14, fontWeight: '700' },
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
