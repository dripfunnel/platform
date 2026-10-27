import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { inviteRider, loadOwnDeliveryPlan, loadRiders, removeRider, resendRiderInvitation, restoreRider, suspendRider, type Rider, type RiderStatus } from '../../../api/settingsRiders'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { dotted } from '../dotted'
import { FormSheet } from '../FormSheet'
import { RowCard, type Tone } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { useWrite } from '../useWrite'
import { isMobile, toE164 } from './riderPhone'

const tones: Record<RiderStatus, Tone> = { active: 'ok', invited: 'wait', suspended: 'off' }

// Settings › Riders (SetRiders; docs/api/DELIVERY.md §5, §8): the Owner's own delivery people, with invite, resend, suspend, restore and remove. Listed only
// with a plan that has own delivery; the API checks it again on every call.
export function RidersTab() {
  return (
    <TabFrame
      label={t('settings.tabs.riders')}
      load={async (client) => ((await loadOwnDeliveryPlan(client)) ? { plan: true, riders: await loadRiders(client) } : { plan: false, riders: [] as Rider[] })}
    >
      {({ data, client, canEdit, refresh }) => (data.plan ? <RiderList riders={data.riders} client={client} canEdit={canEdit} refresh={refresh} /> : <NotInPlan />)}
    </TabFrame>
  )
}

function NotInPlan() {
  const { colors } = useTheme()
  return (
    <SectionCard title={t('settings.riders.notAvailable.title')}>
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.riders.notAvailable.body')}</Text>
    </SectionCard>
  )
}

type Sheet = { kind: 'invite' } | { kind: 'suspend' | 'remove'; rider: Rider }
type Props = { riders: readonly Rider[]; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }

function RiderList({ riders, client, canEdit, refresh }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const write = useWrite('settingsRiders')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const close = () => setSheet(null)

  const run = (work: () => Promise<void>, done: string) =>
    void write.run(async () => {
      await work()
      await refresh()
      return done
    })

  const openMenu = (rider: Rider) =>
    feedback.menu({
      title: rider.name,
      ...(rider.phone ? { sub: rider.phone } : {}),
      items:
        rider.status === 'invited'
          ? [
              { key: 'resend', label: t('settings.riders.resend'), onPress: () => run(() => resendRiderInvitation(client, rider.id), t('settings.riders.resent', { name: rider.name })) },
              { key: 'remove', label: t('settings.riders.cancelInvitation'), danger: true, onPress: () => setSheet({ kind: 'remove', rider }) },
            ]
          : [
              rider.status === 'suspended'
                ? { key: 'restore', label: t('settings.riders.restore'), onPress: () => run(() => restoreRider(client, rider.id), t('settings.riders.restored', { name: rider.name })) }
                : { key: 'suspend', label: t('settings.riders.suspend'), onPress: () => setSheet({ kind: 'suspend', rider }) },
              { key: 'remove', label: t('settings.riders.remove'), danger: true, onPress: () => setSheet({ kind: 'remove', rider }) },
            ],
    })

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.riders.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.riders.sub')}</Text>
        {canEdit ? <Button saves label={t('settings.riders.invite')} onPress={() => setSheet({ kind: 'invite' })} /> : null}
      </View>
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      {riders.length === 0 ? (
        <SectionCard title={t('settings.riders.emptyTitle')}>
          <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.riders.emptyBody')}</Text>
        </SectionCard>
      ) : null}
      {riders.map((rider) => (
        <RowCard
          key={rider.id}
          title={rider.name}
          sub={dotted([rider.phone, rider.status === 'active' ? t(rider.online ? 'settings.riders.online' : 'settings.riders.offline') : null, rider.currentDeliveryId ? t('settings.riders.onDelivery') : null])}
          value={tCount('settings.riders.delivered', rider.deliveriesDone, { count: formatNumber(rider.deliveriesDone, locale) })}
          status={t(`settings.riders.statuses.${rider.status}`)}
          tone={tones[rider.status]}
          onPress={canEdit ? () => openMenu(rider) : null}
          accessibilityLabel={t('settings.riders.manage', { name: rider.name })}
        />
      ))}

      {sheet?.kind === 'invite' ? <InviteSheet client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'suspend' ? (
        <FormSheet
          title={t('settings.riders.suspendTitle', { name: sheet.rider.name })}
          body={t('settings.riders.suspendBody')}
          confirm={t('settings.riders.suspend')}
          danger
          context="settingsRiders"
          onClose={close}
          onSubmit={async () => {
            await suspendRider(client, sheet.rider.id)
            await refresh()
            return t('settings.riders.suspended', { name: sheet.rider.name })
          }}
        />
      ) : null}
      {sheet?.kind === 'remove' ? (
        <FormSheet
          title={t('settings.riders.removeTitle', { name: sheet.rider.name })}
          body={t(sheet.rider.status === 'invited' ? 'settings.riders.removeInvitedBody' : 'settings.riders.removeBody')}
          confirm={t(sheet.rider.status === 'invited' ? 'settings.riders.cancelInvitation' : 'settings.riders.remove')}
          danger
          context="settingsRiders"
          onClose={close}
          onSubmit={async () => {
            await removeRider(client, sheet.rider.id)
            await refresh()
            return t('settings.riders.removed', { name: sheet.rider.name })
          }}
        />
      ) : null}
    </>
  )
}

function InviteSheet({ client, onClose, onDone }: { client: ApiClient; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('+')
  const [tried, setTried] = useState(false)
  return (
    <FormSheet
      title={t('settings.riders.inviteTitle')}
      body={t('settings.riders.inviteBody')}
      confirm={t('settings.riders.send')}
      context="settingsRiders"
      onClose={onClose}
      check={() => {
        setTried(true)
        return name.trim() === '' ? t('settings.riders.nameMissing') : isMobile(phone) ? null : t('settings.riders.mobileInvalid')
      }}
      onSubmit={async () => {
        await inviteRider(client, name.trim(), toE164(phone))
        await onDone()
        return t('settings.riders.invited', { phone: toE164(phone) })
      }}
    >
      <TextField label={t('settings.riders.name')} value={name} onChangeText={setName} placeholder={t('settings.riders.namePlaceholder')} autoCapitalize="words" maxLength={120} invalid={tried && name.trim() === ''} />
      <TextField label={t('settings.riders.mobile')} value={phone} onChangeText={setPhone} placeholder={t('settings.riders.mobilePlaceholder')} keyboardType="phone-pad" help={t('settings.riders.mobileBody')} invalid={tried && !isMobile(phone)} />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
