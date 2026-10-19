import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadAccess } from '../../api/products'
import { changeTeamRole, loadMyTeam, loadSupplierName, removeTeammate, resendTeamInvitation, revokeTeamInvitation, type TeamRole, type Teammate } from '../../api/supplier'
import type { ApiClient } from '../../graphql'
import { formatDateTime } from '../../format'
import { locale, t } from '../../messages'
import type { SupplierTier } from '../../nav'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { useLoad } from '../common/useLoad'
import { loadStateOf } from '../orders/loadState'
import { dotted } from '../settings/dotted'
import { FormSheet } from '../settings/FormSheet'
import { RowCard } from '../settings/RowCard'
import { useFeedback } from '../shell/Feedback'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { supplierAccessOf } from './access'
import { InviteTeammateSheet } from './InviteTeammateSheet'

type Sheet = { kind: 'invite' } | { kind: 'role'; person: Teammate; to: TeamRole } | { kind: 'remove'; person: Teammate } | { kind: 'resend'; person: Teammate } | { kind: 'cancel'; person: Teammate }

const roleName = (role: TeamRole): string => t(`supplier.team.roles.${role}`)
const nameOf = (person: Teammate): string => person.name || person.email

// Your team (FIRST-RELEASE (store) §17, ACCESS.md §7.5; VendorViews "team" at phone width): a Supplier admin's own people and invitations. Invite, resend, cancel,
// change a role, remove; the last admin can't change or leave, which its menu says. Asks the API only for a seat that holds `supplier.team`.
export function TeamScreen() {
  const { state, online } = useShell()
  const client = sessionClient()
  const permissions = useLoad(() => loadAccess(client), [client])
  const access = permissions.state.status === 'ready' ? supplierAccessOf(permissions.state.data, state?.readOnly === true) : null

  if (permissions.state.status === 'error') {
    return (
      <ShellScreen label={t('supplier.team.label')} state={loadStateOf(permissions.state.error, online)} onRetry={permissions.reload}>
        {null}
      </ShellScreen>
    )
  }
  if (access !== null && !access.canOpenTeam) {
    return (
      <ShellScreen label={t('supplier.team.label')} state="denied">
        {null}
      </ShellScreen>
    )
  }
  if (access === null) {
    return (
      <ShellScreen label={t('supplier.team.label')}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </ShellScreen>
    )
  }
  return <TeamLoaded client={client} canChange={access.canChangeTeam} />
}

function TeamLoaded({ client, canChange }: { client: ApiClient; canChange: boolean }) {
  const { online, acting, seat } = useShell()
  const team = useLoad(() => Promise.all([loadMyTeam(client), loadSupplierName(client).catch(() => null)]), [client])
  const { set } = team
  const name = team.state.status === 'ready' ? team.state.data[1] : null

  // Reads the team again without the skeleton; a read that fails leaves the list as it was.
  const refresh = useCallback(async () => {
    try {
      set([await loadMyTeam(client), name])
    } catch {
      // The write has been said already.
    }
  }, [client, set, name])

  if (team.state.status === 'error') {
    return (
      <ShellScreen label={t('supplier.team.label')} state={loadStateOf(team.state.error, online)} onRetry={team.reload}>
        {null}
      </ShellScreen>
    )
  }
  if (team.state.status === 'loading') {
    return (
      <ShellScreen label={t('supplier.team.label')}>
        <View style={styles.content}>
          <Skeleton />
        </View>
      </ShellScreen>
    )
  }
  return (
    <ShellScreen label={t('supplier.team.label')} onRetry={team.reload}>
      <View style={styles.content}>
        <TeamList people={team.state.data[0]} supplier={name ?? t('supplier.yourCompany')} store={acting.storeName} tier={seat?.side === 'supplier' ? seat.tier : 'vendor-catalogue'} client={client} canChange={canChange} refresh={refresh} />
      </View>
    </ShellScreen>
  )
}

type ListProps = {
  people: readonly Teammate[]
  supplier: string
  store: string
  tier: SupplierTier
  client: ApiClient
  canChange: boolean
  refresh: () => Promise<void>
}

function TeamList({ people, supplier, store, tier, client, canChange, refresh }: ListProps) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const when = (iso: string) => formatDateTime(iso, locale, 'UTC')

  const openMenu = (person: Teammate) => {
    const name = nameOf(person)
    if (person.kind === 'invitation') {
      feedback.menu({
        title: name,
        sub: person.expired ? t('supplier.team.status.expired') : person.expiresAt ? t('supplier.team.linkUntil', { when: when(person.expiresAt) }) : person.email,
        items: [
          { key: 'resend', label: t('supplier.team.resend'), onPress: () => setSheet({ kind: 'resend', person }) },
          { key: 'cancel', label: t('supplier.team.cancelInvite'), danger: true, onPress: () => setSheet({ kind: 'cancel', person }) },
        ],
      })
      return
    }
    if (person.lastAdmin) {
      feedback.menu({ title: name, sub: t('supplier.team.lastAdmin'), items: [{ key: 'ok', label: t('supplier.team.ok'), onPress: () => undefined }] })
      return
    }
    const other: TeamRole = person.role === 'supplier-admin' ? 'supplier-member' : 'supplier-admin'
    feedback.menu({
      title: name,
      sub: `${roleName(person.role)} · ${person.email}`,
      items: [
        { key: 'role', label: other === 'supplier-admin' ? t('supplier.team.makeAdmin') : t('supplier.team.makeMember'), onPress: () => setSheet({ kind: 'role', person, to: other }) },
        { key: 'remove', label: t('supplier.team.remove', { supplier }), danger: true, onPress: () => setSheet({ kind: 'remove', person }) },
      ],
    })
  }

  const close = () => setSheet(null)
  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('more.team')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('supplier.team.sub', { supplier, store })}</Text>
        {canChange ? <Button saves label={t('supplier.team.invite')} onPress={() => setSheet({ kind: 'invite' })} /> : null}
      </View>
      {!canChange ? <Text style={[styles.sub, { color: colors.muted }]}>{t('supplier.team.readOnly')}</Text> : null}
      {people.map((person) => (
        <RowCard
          key={person.id}
          title={nameOf(person)}
          sub={person.kind === 'invitation' ? dotted([person.email, person.expired || !person.expiresAt ? t('supplier.team.status.expired') : t('supplier.team.linkUntil', { when: when(person.expiresAt) })]) : person.name ? person.email : undefined}
          value={roleName(person.role)}
          status={person.kind === 'invitation' ? (person.expired ? t('supplier.team.status.expired') : t('supplier.team.status.invited')) : person.you ? t('supplier.team.status.you') : t('supplier.team.status.active')}
          tone={person.kind === 'invitation' ? 'wait' : 'plain'}
          onPress={canChange ? () => openMenu(person) : null}
          accessibilityLabel={t('supplier.team.manage', { name: nameOf(person) })}
        />
      ))}
      {people.every((person) => person.you) ? <Text style={[styles.sub, { color: colors.muted }]}>{t('supplier.team.alone', { supplier })}</Text> : null}
      <Text style={[styles.sub, { color: colors.muted }]}>{t('supplier.team.foot', { supplier, store })}</Text>

      {sheet?.kind === 'invite' ? <InviteTeammateSheet supplier={supplier} tier={tier} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'role' ? (
        <FormSheet
          title={t('supplier.team.roleFor', { name: nameOf(sheet.person) })}
          body={t(sheet.to === 'supplier-admin' ? 'supplier.team.makeAdminBody' : 'supplier.team.makeMemberBody', { name: nameOf(sheet.person) })}
          confirm={sheet.to === 'supplier-admin' ? t('supplier.team.makeAdmin') : t('supplier.team.makeMember')}
          context="supplierTeam"
          onClose={close}
          onSubmit={async () => {
            await changeTeamRole(client, sheet.person.id, sheet.to)
            await refresh()
            return t(sheet.to === 'supplier-admin' ? 'supplier.team.nowAdmin' : 'supplier.team.nowMember', { name: nameOf(sheet.person) })
          }}
        />
      ) : null}
      {sheet?.kind === 'remove' ? (
        <FormSheet
          title={t('supplier.team.removeTitle', { name: nameOf(sheet.person), supplier })}
          body={t('supplier.team.removeBody', { store })}
          confirm={t('supplier.team.removeConfirm')}
          danger
          context="supplierTeam"
          onClose={close}
          onSubmit={async () => {
            await removeTeammate(client, sheet.person.id)
            await refresh()
            return t('supplier.team.removed', { name: nameOf(sheet.person) })
          }}
        />
      ) : null}
      {sheet?.kind === 'resend' ? (
        <FormSheet
          title={t('supplier.team.resendTitle', { email: sheet.person.email })}
          body={t('supplier.team.resendBody')}
          confirm={t('supplier.team.resendConfirm')}
          context="supplierTeam"
          onClose={close}
          onSubmit={async () => {
            await resendTeamInvitation(client, sheet.person.id)
            await refresh()
            return t('supplier.team.resent', { email: sheet.person.email })
          }}
        />
      ) : null}
      {sheet?.kind === 'cancel' ? (
        <FormSheet
          title={t('supplier.team.cancelTitle', { email: sheet.person.email })}
          body={t('supplier.team.cancelBody')}
          confirm={t('supplier.team.cancelInvite')}
          danger
          context="supplierTeam"
          onClose={close}
          onSubmit={async () => {
            await revokeTeamInvitation(client, sheet.person.id)
            await refresh()
            return t('supplier.team.cancelled', { email: sheet.person.email })
          }}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 12, paddingBottom: 32 },
  head: { gap: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
