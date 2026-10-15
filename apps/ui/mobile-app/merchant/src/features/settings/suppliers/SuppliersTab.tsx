import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import {
  accessLevels,
  addSupplierPerson,
  inviteSupplier,
  loadApproval,
  loadSuppliers,
  removeSupplier,
  resumeSupplier,
  setApproval,
  setShippingMode,
  setSupplierAccess,
  suspendSupplier,
  type AccessLevel,
  type ShippingMode,
  type Supplier,
} from '../../../api/settingsPeople'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { ChoiceRows } from '../ChoiceRows'
import { dotted } from '../dotted'
import { looksLikeEmail } from '../email'
import { FilterChips } from '../FilterChips'
import { FormSheet } from '../FormSheet'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { suppliersShown, supplierCounts, type SupplierFilter } from './supplierView'

const accessName = (level: AccessLevel): string => t(`settings.suppliers.access.${level}`)
const accessChoices = () => accessLevels.map((level) => ({ value: level, label: accessName(level), sub: t(`settings.suppliers.accessSubs.${level}`) }))

// Settings › Suppliers (SetTeam, supplier; ACCESS.md §7): each company with its access level, how it ships and its status, the approval switch, and
// invite, add a person, change access or shipping, suspend, reactivate and remove. A supplier's people are the company's; invitations go by email.
export function SuppliersTab() {
  return (
    <TabFrame label={t('settings.tabs.suppliers')} load={async (client) => ({ suppliers: await loadSuppliers(client), approval: await loadApproval(client) })}>
      {({ data, client, canEdit, refresh }) => <SupplierList suppliers={data.suppliers} approval={data.approval} client={client} canEdit={canEdit} refresh={refresh} />}
    </TabFrame>
  )
}

type Sheet =
  | { kind: 'invite' }
  | { kind: 'approval' }
  | { kind: 'person'; supplier: Supplier }
  | { kind: 'access'; supplier: Supplier }
  | { kind: 'shipping'; supplier: Supplier }
  | { kind: 'suspend'; supplier: Supplier }
  | { kind: 'remove'; supplier: Supplier }

type Props = { suppliers: readonly Supplier[]; approval: boolean; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }

function SupplierList({ suppliers, approval, client, canEdit, refresh }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [filter, setFilter] = useState<SupplierFilter>('all')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const counts = supplierCounts(suppliers)
  const products = suppliers.reduce((total, supplier) => total + supplier.products, 0)

  const resume = async (supplier: Supplier) => {
    try {
      await resumeSupplier(client, supplier.id)
      feedback.toast({ message: t('settings.suppliers.resumed', { name: supplier.name }) })
      await refresh()
    } catch (error) {
      feedback.toast({ message: errorMessage(error, 'settingsSuppliers') })
    }
  }

  const openMenu = (supplier: Supplier) =>
    feedback.menu({
      title: supplier.name,
      sub: dotted([accessName(supplier.accessLevel), tCount('settings.suppliers.users', supplier.users)]),
      items: [
        ...(supplier.status === 'suspended' ? [] : [{ key: 'person', label: t('settings.suppliers.addPerson'), onPress: () => setSheet({ kind: 'person', supplier }) }]),
        { key: 'access', label: t('settings.suppliers.changeAccess'), onPress: () => setSheet({ kind: 'access', supplier }) },
        { key: 'shipping', label: t('settings.suppliers.changeShipping'), onPress: () => setSheet({ kind: 'shipping', supplier }) },
        supplier.status === 'suspended'
          ? { key: 'suspend', label: t('settings.suppliers.resume'), onPress: () => void resume(supplier) }
          : { key: 'suspend', label: t('settings.suppliers.suspend'), danger: true, onPress: () => setSheet({ kind: 'suspend', supplier }) },
        { key: 'remove', label: t('settings.suppliers.remove'), danger: true, onPress: () => setSheet({ kind: 'remove', supplier }) },
      ],
    })

  const close = () => setSheet(null)

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.suppliers.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{tCount('settings.suppliers.sub', suppliers.length, { products })}</Text>
        {canEdit ? <Button saves label={t('settings.suppliers.invite')} onPress={() => setSheet({ kind: 'invite' })} /> : null}
      </View>
      <View style={styles.approval}>
        <Switch label={t('settings.suppliers.approvalTitle')} value={approval} disabled={!canEdit} onChange={() => setSheet({ kind: 'approval' })} />
        <Text style={[styles.sub, { color: colors.muted }]}>{approval ? t('settings.suppliers.approvalOnSub') : t('settings.suppliers.approvalOffSub')}</Text>
      </View>
      <FilterChips
        label={t('settings.suppliers.filter')}
        value={filter}
        onChange={setFilter}
        chips={[
          { key: 'all', label: t('settings.suppliers.all'), count: suppliers.length },
          { key: 'active', label: t('settings.suppliers.activeChip'), count: counts.active },
          { key: 'suspended', label: t('settings.suppliers.suspendedChip'), count: counts.suspended },
        ]}
      />
      {suppliersShown(suppliers, filter).length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{suppliers.length === 0 ? t('settings.suppliers.none') : t('settings.suppliers.noneHere')}</Text> : null}
      {suppliersShown(suppliers, filter).map((supplier) => (
        <RowCard
          key={supplier.id}
          title={supplier.name}
          sub={dotted([tCount('settings.suppliers.users', supplier.users), tCount('settings.suppliers.products', supplier.products)])}
          value={accessName(supplier.accessLevel)}
          status={t(`settings.suppliers.status.${supplier.status}`)}
          tone={supplier.status === 'active' ? 'ok' : supplier.status === 'invited' ? 'wait' : 'off'}
          onPress={canEdit ? () => openMenu(supplier) : null}
          accessibilityLabel={t('settings.suppliers.manage', { name: supplier.name })}
        />
      ))}
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.suppliers.foot')}</Text>

      {sheet?.kind === 'invite' ? <InviteSupplierSheet client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'approval' ? (
        <FormSheet
          title={approval ? t('settings.suppliers.approvalTurnOff') : t('settings.suppliers.approvalTurnOn')}
          body={approval ? t('settings.suppliers.approvalOffConsequence') : t('settings.suppliers.approvalOnConsequence')}
          confirm={approval ? t('settings.suppliers.turnOff') : t('settings.suppliers.turnOn')}
          context="settingsSuppliers"
          onClose={close}
          onSubmit={async () => {
            await setApproval(client, !approval)
            await refresh()
            return approval ? t('settings.suppliers.approvalOffNow') : t('settings.suppliers.approvalOnNow')
          }}
        />
      ) : null}
      {sheet?.kind === 'person' ? <AddPersonSheet supplier={sheet.supplier} client={client} onClose={close} /> : null}
      {sheet?.kind === 'access' ? <AccessSheet supplier={sheet.supplier} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'shipping' ? <ShippingSheet supplier={sheet.supplier} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'suspend' ? <SuspendSheet supplier={sheet.supplier} client={client} onClose={close} onDone={refresh} /> : null}
      {sheet?.kind === 'remove' ? (
        <FormSheet
          title={t('settings.suppliers.removeTitle', { name: sheet.supplier.name })}
          body={tCount('settings.suppliers.removeBody', sheet.supplier.products)}
          confirm={t('settings.suppliers.remove')}
          danger
          context="settingsSuppliers"
          onClose={close}
          onSubmit={async () => {
            const hidden = await removeSupplier(client, sheet.supplier.id)
            await refresh()
            return tCount('settings.suppliers.removed', hidden, { name: sheet.supplier.name })
          }}
        />
      ) : null}
    </>
  )
}

type DoneProps = { client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

function InviteSupplierSheet({ client, onClose, onDone }: DoneProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState<AccessLevel>('vendor-catalogue')
  const [tried, setTried] = useState(false)
  const { colors } = useTheme()
  return (
    <FormSheet
      title={t('settings.suppliers.invite')}
      body={t('settings.suppliers.inviteBody')}
      confirm={t('settings.suppliers.send')}
      context="settingsSuppliers"
      onClose={onClose}
      check={() => {
        setTried(true)
        return name.trim() === '' ? t('settings.suppliers.companyMissing') : looksLikeEmail(email) ? null : t('settings.suppliers.emailInvalid')
      }}
      onSubmit={async () => {
        await inviteSupplier(client, { name: name.trim(), email: email.trim(), accessLevel: level })
        await onDone()
        return t('settings.suppliers.invited', { email: email.trim(), name: name.trim() })
      }}
    >
      <TextField label={t('settings.suppliers.company')} value={name} onChangeText={setName} placeholder={t('settings.suppliers.companyPlaceholder')} autoCapitalize="words" invalid={tried && name.trim() === ''} />
      <TextField label={t('settings.suppliers.email')} value={email} onChangeText={setEmail} placeholder={t('settings.suppliers.emailPlaceholder')} keyboardType="email-address" autoComplete="email" invalid={tried && !looksLikeEmail(email)} />
      <ChoiceRows label={t('settings.suppliers.accessThey')} value={level} options={accessChoices()} onChange={setLevel} />
      <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.suppliers.neverCustomers')}</Text>
    </FormSheet>
  )
}

function AddPersonSheet({ supplier, client, onClose }: { supplier: Supplier; client: ApiClient; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [tried, setTried] = useState(false)
  return (
    <FormSheet
      title={t('settings.suppliers.addPersonTitle', { name: supplier.name })}
      body={t('settings.suppliers.addPersonBody', { name: supplier.name })}
      confirm={t('settings.suppliers.send')}
      context="settingsSuppliers"
      onClose={onClose}
      check={() => {
        setTried(true)
        return looksLikeEmail(email) ? null : t('settings.suppliers.emailInvalid')
      }}
      onSubmit={async () => {
        await addSupplierPerson(client, supplier.id, email.trim())
        return t('settings.suppliers.invited', { email: email.trim(), name: supplier.name })
      }}
    >
      <TextField label={t('settings.suppliers.email')} value={email} onChangeText={setEmail} placeholder={t('settings.suppliers.emailPlaceholder')} keyboardType="email-address" autoComplete="email" invalid={tried && !looksLikeEmail(email)} />
    </FormSheet>
  )
}

function AccessSheet({ supplier, client, onClose, onDone }: DoneProps & { supplier: Supplier }) {
  const [level, setLevel] = useState<AccessLevel>(supplier.accessLevel)
  return (
    <FormSheet
      title={t('settings.suppliers.accessLabel', { name: supplier.name })}
      body={t('settings.suppliers.takesMinutes')}
      confirm={t('settings.common.save')}
      context="settingsSuppliers"
      onClose={onClose}
      ready={level !== supplier.accessLevel}
      onSubmit={async () => {
        await setSupplierAccess(client, supplier.id, level)
        await onDone()
        return t('settings.suppliers.accessChanged', { name: supplier.name, access: accessName(level) })
      }}
    >
      <ChoiceRows value={level} options={accessChoices()} onChange={setLevel} />
    </FormSheet>
  )
}

function ShippingSheet({ supplier, client, onClose, onDone }: DoneProps & { supplier: Supplier }) {
  const [mode, setMode] = useState<ShippingMode>(supplier.shippingMode)
  const [labels, setLabels] = useState<'store' | 'own'>(supplier.labelAccount ?? 'store')
  return (
    <FormSheet
      title={t('settings.suppliers.shippingTitle', { name: supplier.name })}
      body={t('settings.suppliers.shippingBody')}
      confirm={t('settings.common.save')}
      context="settingsSuppliers"
      ready={mode !== supplier.shippingMode || (mode === 'to-shopper' && labels !== (supplier.labelAccount ?? 'store'))}
      onClose={onClose}
      onSubmit={async () => {
        // Who books labels is asked only for items that go straight to the shopper; otherwise the stored one goes back, so it is never changed unseen.
        await setShippingMode(client, supplier.id, mode, mode === 'to-shopper' ? labels : (supplier.labelAccount ?? 'store'))
        await onDone()
        return t('settings.suppliers.shippingChanged', { name: supplier.name })
      }}
    >
      <ChoiceRows
        label={t('settings.suppliers.shippingLabel')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'to-store', label: t('settings.suppliers.toStore') },
          { value: 'to-shopper', label: t('settings.suppliers.toShopper') },
        ]}
      />
      {mode === 'to-shopper' ? (
        <ChoiceRows
          label={t('settings.suppliers.labelsLabel')}
          value={labels}
          onChange={setLabels}
          options={[
            { value: 'store', label: t('settings.suppliers.labelsStore') },
            { value: 'own', label: t('settings.suppliers.labelsOwn') },
          ]}
        />
      ) : null}
    </FormSheet>
  )
}

function SuspendSheet({ supplier, client, onClose, onDone }: DoneProps & { supplier: Supplier }) {
  const [hide, setHide] = useState<'hide' | 'keep'>('hide')
  return (
    <FormSheet
      title={t('settings.suppliers.suspendTitle', { name: supplier.name })}
      body={tCount('settings.suppliers.suspendBody', supplier.products)}
      confirm={t('settings.suppliers.suspend')}
      danger
      context="settingsSuppliers"
      onClose={onClose}
      onSubmit={async () => {
        await suspendSupplier(client, supplier.id, hide === 'hide')
        await onDone()
        return t(hide === 'hide' ? 'settings.suppliers.suspendedHidden' : 'settings.suppliers.suspended', { name: supplier.name })
      }}
    >
      <ChoiceRows
        label={t('settings.suppliers.theirProducts')}
        value={hide}
        onChange={setHide}
        options={[
          { value: 'hide', label: t('settings.suppliers.hideProducts') },
          { value: 'keep', label: t('settings.suppliers.keepSelling') },
        ]}
      />
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  approval: { gap: 4 },
})
