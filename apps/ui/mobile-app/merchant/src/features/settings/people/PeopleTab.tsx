import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { changeRole, inviteMember, loadPeople, removeMember, resendInvitation, revokeInvitation, staffRoles, type Person, type StaffRole } from '../../../api/settingsPeople'
import { loadStoreInfo } from '../../../api/settingsStore'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { ChoiceRows } from '../ChoiceRows'
import { dotted } from '../dotted'
import { looksLikeEmail } from '../email'
import { FilterChips } from '../FilterChips'
import { FormSheet } from '../FormSheet'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { countsOf, peopleShown, type PeopleFilter } from './peopleView'

const roleName = (role: StaffRole): string => t(`settings.people.roles.${role}`)
const roleChoices = () => staffRoles.map((role) => ({ value: role, label: roleName(role), sub: t(`settings.people.roleSubs.${role}`) }))

// Settings › People (SetTeam, people; ACCESS.md §5–§7): everyone who works in the store with the invitations waiting. Invite, resend, cancel, change
// a role, remove from this store (never the account). The invitation email is sent by the server; the app never sees a link.
export function PeopleTab() {
  return (
    <TabFrame
      label={t('settings.tabs.people')}
      load={async (client) => {
        const [people, info] = await Promise.all([loadPeople(client), loadStoreInfo(client)])
        if (!info) throw new Error('store info missing')
        return { people, timeZone: info.timeZone }
      }}
    >
      {({ data, client, canEdit, refresh }) => <PeopleList people={data.people} timeZone={data.timeZone} client={client} canEdit={canEdit} refresh={refresh} />}
    </TabFrame>
  )
}

type Sheet = { kind: 'invite' } | { kind: 'resend'; person: Person } | { kind: 'role'; person: Person } | { kind: 'remove'; person: Person } | { kind: 'cancel'; person: Person }
type ListProps = { people: readonly Person[]; timeZone: string; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }

function PeopleList({ people, timeZone, client, canEdit, refresh }: ListProps) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [filter, setFilter] = useState<PeopleFilter>('all')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const counts = countsOf(people)
  const shown = peopleShown(people, filter)
  const when = (iso: string) => formatDateTime(iso, locale, timeZone)

  const openMenu = (person: Person) => {
    const name = person.name || person.email
    if (person.kind === 'invitation') {
      feedback.menu({
        title: name,
        sub: person.expired ? t('settings.people.expired') : person.expiresAt ? t('settings.people.expires', { when: when(person.expiresAt) }) : person.email,
        items: [
          { key: 'resend', label: t('settings.people.resend'), onPress: () => setSheet({ kind: 'resend', person }) },
          { key: 'cancel', label: t('settings.people.cancelInvite'), danger: true, onPress: () => setSheet({ kind: 'cancel', person }) },
        ],
      })
      return
    }
    feedback.menu({
      title: name,
      sub: `${roleName(person.role)} · ${person.email}`,
      items: [
        { key: 'role', label: t('settings.people.changeRole'), onPress: () => setSheet({ kind: 'role', person }) },
        { key: 'remove', label: t('settings.people.removeFromStore'), danger: true, onPress: () => setSheet({ kind: 'remove', person }) },
      ],
    })
  }

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.people.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.people.sub', { active: counts.members, waiting: counts.waiting })}</Text>
        {canEdit ? <Button saves label={t('settings.people.invite')} onPress={() => setSheet({ kind: 'invite' })} /> : null}
      </View>
      <FilterChips
        label={t('settings.people.filter')}
        value={filter}
        onChange={setFilter}
        chips={[
          { key: 'all', label: t('settings.people.everyone'), count: people.length },
          { key: 'staff', label: t('settings.people.staff'), count: counts.members },
          { key: 'waiting', label: t('settings.people.waiting'), count: counts.waiting },
        ]}
      />
      {shown.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.people.nobody')}</Text> : null}
      {shown.map((person) => (
        <RowCard
          key={person.id}
          title={person.name || person.email}
          sub={
            person.kind === 'invitation'
              ? dotted([person.email, person.expired ? t('settings.people.expiredShort') : t('settings.people.invitedOn', { when: when(person.since) })])
              : person.you
                ? dotted([person.email, t('settings.people.you')])
                : person.email
          }
          value={roleName(person.role)}
          status={person.kind === 'invitation' ? (person.expired ? t('settings.people.expiredShort') : t('settings.people.waitingStatus')) : t('settings.people.active')}
          tone={person.kind === 'invitation' ? 'wait' : 'ok'}
          onPress={canEdit ? () => openMenu(person) : null}
          accessibilityLabel={t('settings.people.manage', { name: person.name || person.email })}
        />
      ))}
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.people.foot')}</Text>

      {sheet?.kind === 'invite' ? <InviteSheet client={client} onClose={() => setSheet(null)} onDone={refresh} /> : null}
      {sheet?.kind === 'role' ? <RoleSheet person={sheet.person} client={client} onClose={() => setSheet(null)} onDone={refresh} /> : null}
      {sheet?.kind === 'remove' ? (
        <FormSheet
          title={t('settings.people.removeTitle', { name: sheet.person.name || sheet.person.email })}
          body={t('settings.people.removeBody')}
          confirm={t('settings.common.remove')}
          danger
          context="settingsPeople"
          onClose={() => setSheet(null)}
          onSubmit={async () => {
            await removeMember(client, sheet.person.id)
            await refresh()
            return t('settings.people.removed', { name: sheet.person.name || sheet.person.email })
          }}
        />
      ) : null}
      {sheet?.kind === 'resend' ? (
        <FormSheet
          title={t('settings.people.resendTitle', { email: sheet.person.email })}
          body={t('settings.people.resendBody')}
          confirm={t('settings.people.resendConfirm')}
          context="settingsPeople"
          onClose={() => setSheet(null)}
          onSubmit={async () => {
            await resendInvitation(client, sheet.person.id)
            await refresh()
            return t('settings.people.resent', { email: sheet.person.email })
          }}
        />
      ) : null}
      {sheet?.kind === 'cancel' ? (
        <FormSheet
          title={t('settings.people.cancelInviteTitle', { email: sheet.person.email })}
          body={t('settings.people.cancelInviteBody')}
          confirm={t('settings.people.cancelInvite')}
          danger
          context="settingsPeople"
          onClose={() => setSheet(null)}
          onSubmit={async () => {
            await revokeInvitation(client, sheet.person.id)
            await refresh()
            return t('settings.people.inviteCancelled')
          }}
        />
      ) : null}
    </>
  )
}

function InviteSheet({ client, onClose, onDone }: { client: ApiClient; onClose: () => void; onDone: () => Promise<void> }) {
  const { colors } = useTheme()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>('staff')
  const [tried, setTried] = useState(false)
  const valid = looksLikeEmail(email)
  return (
    <FormSheet
      title={t('settings.people.invite')}
      body={t('settings.people.inviteBody')}
      confirm={t('settings.people.send')}
      context="settingsPeople"
      onClose={onClose}
      check={() => {
        setTried(true)
        return valid ? null : t('settings.people.emailInvalid')
      }}
      onSubmit={async () => {
        await inviteMember(client, email.trim(), role)
        await onDone()
        return t('settings.people.sent', { email: email.trim() })
      }}
    >
      <TextField label={t('settings.people.email')} value={email} onChangeText={setEmail} placeholder={t('settings.people.emailPlaceholder')} keyboardType="email-address" autoComplete="email" invalid={tried && !valid} />
      <ChoiceRows label={t('settings.people.role')} value={role} options={roleChoices()} onChange={setRole} />
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.people.roleNote')}</Text>
    </FormSheet>
  )
}

function RoleSheet({ person, client, onClose, onDone }: { person: Person; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }) {
  const [role, setRole] = useState<StaffRole>(person.role)
  const name = person.name || person.email
  return (
    <FormSheet
      title={t('settings.people.roleFor', { name })}
      body={t('settings.people.roleTakesTime')}
      confirm={t('settings.people.changeRole')}
      context="settingsPeople"
      onClose={onClose}
      ready={role !== person.role}
      onSubmit={async () => {
        await changeRole(client, person.id, role)
        await onDone()
        return t('settings.people.roleChanged', { name, role: roleName(role) })
      }}
    >
      <ChoiceRows value={role} options={roleChoices()} onChange={setRole} />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
