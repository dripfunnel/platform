import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import type { CustomerGroup } from '../../api/customers'
import type { ApiClient } from '../../graphql'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { errorMessage } from '../../messages/errorMessage'
import { useReloadOnFocus } from '../collections/useReloadOnFocus'
import { stateOfError } from '../common/useLoad'
import { SegmentedControl } from '../shell/SegmentedControl'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import type { CustomersAccess } from './access'
import { AddCustomerSheet } from './AddCustomerSheet'
import { CustomerRow } from './CustomerRow'
import { CustomersFilters } from './CustomersFilters'
import { DeleteGroupSheet } from './DeleteGroupSheet'
import { ExportStatus } from './ExportStatus'
import { GroupNameSheet } from './GroupNameSheet'
import { GroupsPanel } from './GroupsPanel'
import { customerHref } from './routes'
import { useCustomerExport } from './useCustomerExport'
import { useCustomerList } from './useCustomerList'

type Tab = 'people' | 'groups'
type Sheet = { kind: 'add' } | { kind: 'newGroup' } | { kind: 'renameGroup'; group: CustomerGroup } | { kind: 'deleteGroup'; group: CustomerGroup }

const countLabel = (key: 'people' | 'groups', count: number | null): string => (count === null ? t(`customers.tabs.${key}Bare`) : t(`customers.tabs.${key}`, { count: formatNumber(count, locale) }))

// Customers (PortalOrders, Customers; FIRST-RELEASE (store) §7): People with search, the groups as chips and "Show more", and Groups.
// A person opens on their own screen. Export is a job, shared when it is ready.
export function CustomersHome({ access, client }: { access: CustomersAccess; client: ApiClient }) {
  const { colors, radii } = useTheme()
  const router = useRouter()
  const list = useCustomerList(client)
  const exporter = useCustomerExport(client, list.query)
  const [tab, setTab] = useState<Tab>('people')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  useReloadOnFocus(list.reload)

  const filtered = list.query.search !== '' || list.query.groupId !== null
  const empty = list.status === 'ready' && list.count === 0 && !filtered
  const close = () => setSheet(null)
  const open = (id: string) => router.push(customerHref(id) as never)

  const seePeople = (group: CustomerGroup) => {
    list.setSearch('')
    list.setGroupId(group.id)
    setTab('people')
  }

  const people = () => (
    <>
      {empty ? (
        <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
          <Text accessibilityRole="header" style={[styles.emptyTitle, { color: colors.heading }]}>
            {t('customers.empty.title')}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{t('customers.empty.body')}</Text>
        </View>
      ) : (
        <CustomersFilters search={list.search} onSearch={list.setSearch} groups={list.groups} groupId={list.groupId} onGroup={list.setGroupId} />
      )}
      {list.status === 'loading' ? <Skeleton /> : null}
      {list.status === 'ready' && !empty && list.rows.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('customers.noMatch')}</Text> : null}
      {list.status === 'ready' ? list.rows.map((row) => <CustomerRow key={row.id} row={row} onOpen={() => open(row.id)} />) : null}
      {list.hasMore && list.status === 'ready' ? list.loadingMore ? <ActivityIndicator color={colors.muted} /> : <Button kind="secondary" label={t('customers.showMore')} onPress={list.showMore} /> : null}
    </>
  )

  return (
    <View style={styles.root}>
      <SegmentedControl
        segments={[
          { key: 'people', label: countLabel('people', list.count) },
          { key: 'groups', label: countLabel('groups', list.status === 'ready' ? list.groups.length : null) },
        ]}
        value={tab}
        onChange={setTab}
      />
      <ShellScreen label={t('customers.screen')} onRetry={list.reload} {...(list.status === 'error' ? { state: stateOfError(list.error) } : {})}>
        <View style={styles.content}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
              {t('customers.title')}
            </Text>
            <Text style={[styles.sub, { color: colors.muted }]}>{t('customers.lede')}</Text>
          </View>
          {access.readOnly ? <Notice text={t('customers.readOnly')} /> : null}
          {tab === 'people' && (access.canEdit || (access.canExport && !empty)) ? (
            <View style={styles.actions}>
              {access.canEdit ? (
                <View style={styles.action}>
                  <Button saves label={t('customers.add')} onPress={() => setSheet({ kind: 'add' })} />
                </View>
              ) : null}
              {access.canExport && !empty ? (
                <View style={styles.action}>
                  <Button saves kind="secondary" label={t('customers.export.button')} busy={exporter.busy} onPress={() => void exporter.start()} />
                </View>
              ) : null}
            </View>
          ) : null}
          {exporter.error !== null ? <Notice kind="error" text={errorMessage(exporter.error, 'customers')} /> : null}
          {exporter.job ? <ExportStatus job={exporter.job} onShare={(job) => void exporter.share(job)} /> : null}
          {tab === 'groups' ? (
            list.status === 'loading' ? (
              <Skeleton />
            ) : (
              <GroupsPanel groups={list.groups} canEdit={access.canEdit} onSee={seePeople} onAdd={() => setSheet({ kind: 'newGroup' })} onEdit={(group) => setSheet({ kind: 'renameGroup', group })} onDelete={(group) => setSheet({ kind: 'deleteGroup', group })} />
            )
          ) : (
            people()
          )}
        </View>
      </ShellScreen>
      {sheet?.kind === 'add' ? <AddCustomerSheet client={client} onClose={close} onOpen={open} /> : null}
      {sheet?.kind === 'newGroup' ? <GroupNameSheet client={client} group={null} onClose={close} onDone={list.reload} /> : null}
      {sheet?.kind === 'renameGroup' ? <GroupNameSheet client={client} group={sheet.group} onClose={close} onDone={list.reload} /> : null}
      {sheet?.kind === 'deleteGroup' ? (
        <DeleteGroupSheet
          client={client}
          group={sheet.group}
          onClose={close}
          onDone={() => {
            if (list.groupId === sheet.group.id) list.setGroupId(null)
            list.reload()
          }}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: 14, paddingBottom: 32 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  empty: { borderWidth: 1, padding: 24, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
})
