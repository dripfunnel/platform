import { ConfirmDialog, EmptyState, ErrorState, ExportJobStatus, LoadingState, SearchField, Toast, usePhone, useScreenState, type ConfirmDialogProps, type ExportJobWords } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  addCustomer,
  createGroup,
  customerTagLimits,
  customerPageSize,
  deleteGroup,
  loadCustomer,
  loadCustomerCount,
  loadCustomerGroups,
  loadCustomers,
  recordMarketingStop,
  renameGroup,
  requestCustomerExport,
  setCustomerTags,
  type Customer,
  type CustomerGroup,
  type CustomerPage,
} from '../../api/customers'
import { loadStoreTimeZone } from '../../api/orders'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import '../common/chips.css'
import '../common/form.css'
import { startListExport, useListExport } from '../common/listExport'
import { refusalIn } from '../common/refusal'
import { AddCustomer } from './AddCustomer'
import { CustomerDetail } from './CustomerDetail'
import { customerSample, customerStates, sampleCustomer } from './customerStates'
import { customersAccessOf, spentText, type CustomersAccess } from './customerView'
import { GroupsTab } from './GroupsTab'
import './customers.css'

const words = messages.customers
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/customers')
const refused = refusalIn({ ...words.refused, other: words.failed })

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: CustomerPage; count: number; groups: CustomerGroup[] }
type ListView = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: CustomerPage }
type Meta = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; count: number; groups: CustomerGroup[] }
type Detail = { kind: 'none' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; customer: Customer }
const tabs = ['people', 'groups'] as const
type Tab = (typeof tabs)[number]
type Cursor = { after?: string | null; before?: string | null }
type Dialog = { kind: 'tag' } | { kind: 'stop' } | { kind: 'newGroup' } | { kind: 'renameGroup'; group: CustomerGroup } | { kind: 'deleteGroup'; group: CustomerGroup }

const exportWords: ExportJobWords = {
  preparing: words.export.preparing,
  ready: (count, truncated) => (truncated ? fill(words.export.truncated, { count: formatCount(count) }) : fill(plural(words.export.ready, count), { count: formatCount(count) })),
  download: words.export.download,
  file: (date) => fill(words.export.file, { date }),
  expires: (time) => fill(words.export.expires, { time: formatTime(time) }),
  expired: words.export.expired,
  tooLarge: words.export.tooLarge,
  failed: words.export.failed,
}

const forcedAccess = (forced: string | null, live: CustomersAccess): CustomersAccess => {
  if (forced === 'denied') return { canRead: false, canEdit: false, canExport: false, readOnly: false }
  if (forced === 'readOnly') return { canRead: true, canEdit: false, canExport: true, readOnly: true }
  if (forced) return { canRead: true, canEdit: true, canExport: true, readOnly: false }
  return live
}

/** Customers (PortalOrders › Customers, FIRST-RELEASE §7): People and Groups; ?state= per customerStates.ts. */
export const CustomersPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { customer: chosen } = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(customerStates, harnessEnabled)
  const sample = useMemo(() => customerSample(forced), [forced])
  const access = useMemo(() => forcedAccess(forced, customersAccessOf(acting, state?.readOnly ?? false)), [forced, acting, state])
  const phone = usePhone()
  const exportJob = useListExport('customers')

  const [tab, setTab] = useState<Tab>(forced === 'groups' || forced === 'noGroups' ? 'groups' : 'people')
  const [search, setSearch] = useState('')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [cursor, setCursor] = useState<Cursor>({})
  const [pageIndex, setPageIndex] = useState(0)
  const [list, setList] = useState<ListView>({ kind: 'loading' })
  const [meta, setMeta] = useState<Meta>({ kind: 'loading' })
  const [detail, setDetail] = useState<Detail>({ kind: 'none' })
  const [timeZone, setTimeZone] = useState('UTC')
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const latest = useRef(0)
  const latestDetail = useRef(0)

  // The page of rows follows the search, group and page; the count and the groups are read once and after a change.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setList({ kind: 'loading' })
    if (forced === 'error') return setList({ kind: 'error' })
    if (sample) return setList({ kind: 'ready', page: { rows: sample.rows, next: null, previous: null } })
    if (!access.canRead) return
    void loadCustomers(groupId, search, cursor).then(
      (page) => {
        if (mine === latest.current) setList({ kind: 'ready', page })
      },
      () => {
        if (mine === latest.current) setList({ kind: 'error' })
      },
    )
  }, [forced, sample, access.canRead, groupId, search, cursor])
  useEffect(load, [load])

  const loadMeta = useCallback(() => {
    if (forced === 'loading' || forced === 'error') return
    if (sample) return setMeta({ kind: 'ready', count: sample.count, groups: sample.groups })
    if (!access.canRead) return
    void Promise.all([loadCustomerCount(), loadCustomerGroups()]).then(
      ([count, groups]) => setMeta({ kind: 'ready', count, groups }),
      () => setMeta({ kind: 'error' }),
    )
  }, [forced, sample, access.canRead])
  useEffect(loadMeta, [loadMeta])

  const view: View =
    list.kind === 'error' || meta.kind === 'error' ? { kind: 'error' } : list.kind === 'loading' || meta.kind === 'loading' ? { kind: 'loading' } : { kind: 'ready', page: list.page, count: meta.count, groups: meta.groups }

  useEffect(() => {
    if (forced) return setTimeZone('Asia/Kolkata')
    if (!access.canRead) return
    void loadStoreTimeZone().then((zone) => setTimeZone(zone ?? 'UTC'), () => setTimeZone('UTC'))
  }, [forced, access.canRead])

  const rows = view.kind === 'ready' ? view.page.rows : []
  // The one asked for by its link, or the list's first, as PortalOrders opens it.
  const selectedId = chosen ?? rows[0]?.id ?? null

  const loadDetail = useCallback(() => {
    if (!selectedId) return setDetail({ kind: 'none' })
    if (sample) {
      const row = sample.rows.find((r) => r.id === selectedId)
      return setDetail(row ? { kind: 'ready', customer: sampleCustomer(row, sample.customer) } : { kind: 'none' })
    }
    // Only the latest request answers: a slower one for the customer clicked before never replaces it.
    const mine = ++latestDetail.current
    setDetail((current) => (current.kind === 'ready' && current.customer.id === selectedId ? current : { kind: 'loading' }))
    void loadCustomer(selectedId).then(
      (customer) => {
        if (mine === latestDetail.current) setDetail(customer ? { kind: 'ready', customer } : { kind: 'none' })
      },
      () => {
        if (mine === latestDetail.current) setDetail({ kind: 'error' })
      },
    )
  }, [selectedId, sample])
  useEffect(loadDetail, [loadDetail])

  const reload = () => {
    load()
    loadMeta()
  }
  const refresh = () => {
    reload()
    loadDetail()
  }

  const tabsId = useId()
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ people: null, groups: null })
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.indexOf(tab)
    const next = event.key === 'ArrowRight' ? tabs[(at + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(at + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : undefined
    if (!next) return
    event.preventDefault()
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  const select = (id: string) => void navigate({ to: '/customers', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), customer: id }), replace: true })
  const change = (next: { search?: string; groupId?: string | null }) => {
    if (next.search !== undefined) setSearch(next.search)
    if (next.groupId !== undefined) setGroupId(next.groupId)
    setCursor({})
    setPageIndex(0)
  }

  /** Runs one change, says so, and reads the list and the customer again; false when the API refused it. */
  const act = async (work: () => Promise<void>, done: string): Promise<boolean> => {
    if (sample) {
      setToast(done)
      return true
    }
    setBusy(true)
    try {
      await work()
      setToast(done)
      refresh()
      return true
    } catch (error) {
      setToast(refused(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  const inDialog = (work: () => Promise<void>, done: string) => {
    if (sample) return setDialog(null)
    setBusy(true)
    void work()
      .then(() => {
        setDialog(null)
        setToast(done)
        refresh()
      })
      .catch((error: unknown) => setDialogError(refused(error)))
      .finally(() => setBusy(false))
  }

  const add = (name: string, email: string, phoneNumber: string | null) => {
    if (sample) return setAdding(false)
    setBusy(true)
    void addCustomer(name, email, phoneNumber)
      .then(({ id, existed }) => {
        setAdding(false)
        setToast(fill(existed ? words.addForm.existed : words.addForm.added, { name }))
        change({ search: '', groupId: null })
        select(id)
        refresh()
      })
      .catch((error: unknown) => setToast(refused(error)))
      .finally(() => setBusy(false))
  }

  if (!access.canRead)
    return (
      <div className="df-customers">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )

  const groups = view.kind === 'ready' ? view.groups : []
  const count = view.kind === 'ready' ? view.count : 0
  const customer = detail.kind === 'ready' ? detail.customer : null

  const dialogProps = (): ConfirmDialogProps | null => {
    if (!dialog) return null
    const shared = { open: true, error: dialogError, cancelLabel: words.groups.cancel, onCancel: () => setDialog(null) }
    const name = customer?.name ?? words.row.noName
    const groupName = (initial: string, confirmLabel: string, title: string, run: (value: string) => void): ConfirmDialogProps => ({
      ...shared,
      title,
      target: words.groups.target,
      consequence: words.groups.body,
      confirmLabel,
      input: { label: words.groups.nameLabel, type: 'text', initial, placeholder: words.groups.namePlaceholder, error: (value) => (value.trim() ? null : words.groups.nameMissing) },
      onConfirm: (_, value) => run((value ?? '').trim()),
    })
    switch (dialog.kind) {
      case 'tag':
        return {
          ...shared,
          cancelLabel: words.detail.tag.cancel,
          title: words.detail.tag.title,
          target: name,
          consequence: words.detail.tag.body,
          confirmLabel: words.detail.tag.confirm,
          input: { label: words.detail.tag.label, type: 'text', initial: '', placeholder: words.detail.tag.placeholder, error: (value) => (!value.trim() ? words.detail.tag.missing : value.trim().length > customerTagLimits.length ? words.detail.tag.tooLong : null) },
          onConfirm: (_, value) => {
            const tag = (value ?? '').trim()
            if (!customer || customer.tags.includes(tag)) return setDialog(null)
            inDialog(async () => void (await setCustomerTags(customer.id, [...customer.tags, tag])), fill(words.detail.tagAdded, { tag }))
          },
        }
      case 'stop':
        return {
          ...shared,
          cancelLabel: words.detail.consent.stopCancel,
          title: fill(words.detail.consent.stopTitle, { name }),
          target: name,
          consequence: words.detail.consent.stopBody,
          confirmLabel: words.detail.consent.stopConfirm,
          onConfirm: () => customer && inDialog(() => recordMarketingStop(customer.id), fill(words.detail.consent.stopDone, { name })),
        }
      case 'newGroup':
        return groupName('', words.groups.make, words.groups.newTitle, (value) => inDialog(async () => void (await createGroup(value)), fill(words.groups.made, { name: value })))
      case 'renameGroup':
        return groupName(dialog.group.name, words.groups.save, fill(words.groups.editTitle, { name: dialog.group.name }), (value) => inDialog(() => renameGroup(dialog.group, value), words.groups.saved))
      case 'deleteGroup': {
        const g = dialog.group
        return {
          ...shared,
          danger: true,
          title: fill(words.groups.deleteTitle, { name: g.name }),
          target: g.name,
          consequence: fill(words.groups.deleteBody, { members: fill(plural(words.groups.members, g.members), { count: formatCount(g.members) }), name: g.name }),
          confirmLabel: words.groups.deleteConfirm,
          onConfirm: () =>
            inDialog(async () => {
              await deleteGroup(g.id)
              if (groupId === g.id) change({ groupId: null })
            }, fill(words.groups.deleted, { name: g.name })),
        }
      }
    }
  }
  const openDialog = dialogProps()
  const showDialog = (next: Dialog) => {
    setDialogError(null)
    setDialog(next)
  }

  const filtered = search !== '' || groupId !== null
  const empty = view.kind === 'ready' && count === 0 && !filtered

  return (
    <div className="df-customers">
      <div className="df-customers-head">
        <div>
          <h1 className="df-page-title">{words.title}</h1>
          <p className="df-page-lede">{words.lede}</p>
        </div>
        <div className="df-customers-actions">
          {access.canExport && !phone && !empty && (
            <button type="button" className="df-button" disabled={exportJob?.state === 'preparing' || Boolean(sample)} onClick={() => void startListExport('customers', requestCustomerExport(groupId, search))}>
              {words.export.button}
            </button>
          )}
          {access.canEdit && (
            <button type="button" className="df-button df-button--primary" onClick={() => setAdding(true)}>
              {words.add}
            </button>
          )}
        </div>
      </div>
      {exportJob && (
        <p className="df-customers-note" role="status">
          <ExportJobStatus job={exportJob} words={exportWords} />
        </p>
      )}
      {access.readOnly && <p className="df-customers-readonly">{words.readOnly}</p>}

      {/* The ARIA tabs pattern: arrow keys, Home and End move between the two, and only the chosen one is a tab stop. */}
      <div className="df-customers-tabs" role="tablist" aria-label={words.tabs.label} onKeyDown={onTabKey}>
        {tabs.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el
            }}
            id={`${tabsId}-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
          >
            {fill(t === 'people' ? words.tabs.people : words.tabs.groups, { count: formatCount(t === 'people' ? count : groups.length) })}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="df-customers-panel">
      {adding && <AddCustomer busy={busy} onAdd={add} onCancel={() => setAdding(false)} />}

      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: reload }} />}

      {view.kind === 'ready' && tab === 'groups' && (
        <GroupsTab
          groups={groups}
          canEdit={access.canEdit}
          onSee={(g) => {
            setTab('people')
            change({ groupId: g.id })
          }}
          onAdd={() => showDialog({ kind: 'newGroup' })}
          onEdit={(group) => showDialog({ kind: 'renameGroup', group })}
          onDelete={(group) => showDialog({ kind: 'deleteGroup', group })}
        />
      )}

      {view.kind === 'ready' && tab === 'people' && (empty ? (
        <p className="df-customer-card df-customers-empty">{words.empty}</p>
      ) : (
        <>
          <div className="df-customers-toolbar">
            <SearchField label={words.search.label} placeholder={words.search.placeholder} value={search || undefined} onChange={(value) => change({ search: value ?? '' })} />
            <div className="df-chips" role="group" aria-label={words.chips.label}>
              <button type="button" className="df-chip" aria-pressed={groupId === null} onClick={() => change({ groupId: null })}>
                {words.chips.everyone}
              </button>
              {groups.map((g) => (
                <button key={g.id} type="button" className="df-chip" aria-pressed={groupId === g.id} onClick={() => change({ groupId: g.id })}>
                  {fill(words.chips.group, { name: g.name, count: formatCount(g.members) })}
                </button>
              ))}
            </div>
          </div>
          <div className="df-customers-grid">
            <div>
              <ul className="df-customer-card df-customers-rows" aria-label={words.list.label}>
                {rows.map((row) => {
                  const spent = spentText(row.spent)
                  return (
                    <li key={row.id}>
                      <button type="button" className="df-customers-row" aria-current={row.id === selectedId || undefined} onClick={() => select(row.id)}>
                        <span className="df-customers-cell">
                          <strong>{row.name ?? words.row.noName}</strong>
                          <span className="df-customer-sub">{[row.city, ...row.tags].filter(Boolean).join(words.row.joiner) || row.email}</span>
                        </span>
                        <span className="df-customers-cell df-customers-cell--end">
                          {spent && <span>{spent}</span>}
                          <span className="df-customer-sub">{row.orders > 0 ? fill(plural(words.row.orders, row.orders), { count: formatCount(row.orders) }) : words.row.noOrders}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {rows.length === 0 && <li className="df-customer-sub df-customers-none">{words.noMatch}</li>}
              </ul>
              {(view.page.next || view.page.previous) && (
                <nav className="df-customers-pager" aria-label={words.pages.label}>
                  <span>{fill(words.pages.showing, { from: formatCount(pageIndex * customerPageSize + 1), to: formatCount(pageIndex * customerPageSize + rows.length) })}</span>
                  <span>
                    <button type="button" className="df-button" disabled={!view.page.previous} onClick={() => {
                        setCursor({ before: view.page.previous })
                        setPageIndex((i) => Math.max(0, i - 1))
                      }}>
                      {words.pages.previous}
                    </button>
                    <button type="button" className="df-button" disabled={!view.page.next} onClick={() => {
                        setCursor({ after: view.page.next })
                        setPageIndex((i) => i + 1)
                      }}>
                      {words.pages.next}
                    </button>
                  </span>
                </nav>
              )}
            </div>
            {detail.kind === 'loading' && <LoadingState label={words.detail.loading} />}
            {detail.kind === 'error' && <ErrorState title={words.detail.error} body={words.error.body} retry={{ label: words.detail.retry, onRetry: loadDetail }} />}
            {customer && (
              <CustomerDetail
                key={customer.id}
                customer={customer}
                groups={groups}
                access={access}
                timeZone={timeZone}
                busy={busy}
                act={act}
                sample={Boolean(sample)}
                onTag={() => showDialog({ kind: 'tag' })}
                onStopMarketing={() => showDialog({ kind: 'stop' })}
              />
            )}
          </div>
        </>
      ))}

      </div>

      {openDialog && <ConfirmDialog {...openDialog} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
