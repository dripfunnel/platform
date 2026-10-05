import { ConfirmDialog, EmptyState, ErrorState, FilterSelect, LoadingState, SearchField, Toast, usePhone, useScreenState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addToCollection,
  approveProduct,
  deleteProducts,
  loadHandPicked,
  loadProductCounts,
  loadProducts,
  loadSupplierChoices,
  loadTaxClasses,
  productFilters,
  productPageSize,
  productSorts,
  sendBackProduct,
  setProductsVisible,
  setTaxClass,
  type ProductCounts,
  type ProductFilter,
  type ProductPage,
  type ProductQuery,
  type ProductRow,
  type ProductSort,
} from '../../api/products'
import { harnessEnabled } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { productListSample, productListStates, type ProductListState } from './productListStates'
import { ProductCards, ProductTable } from './ProductRows'
import { ProductsEmpty } from './ProductsEmpty'
import { accessOf, summaryOf, type ProductAccess } from './productView'
import './products.css'

const words = messages.products
const shellRoute = getRouteApi('/_app')

const countOf: Record<ProductFilter, keyof ProductCounts> = {
  all: 'all',
  visible: 'visible',
  hidden: 'hidden',
  pending: 'pending',
  sent_back: 'sentBack',
  low_stock: 'lowStock',
  missing_info: 'missingInfo',
}

const firstQuery: ProductQuery = { filter: 'all', search: '', supplier: '', sort: 'updated' }

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: ProductPage; counts: ProductCounts }

type Cursor = { after?: string | null; before?: string | null }

type Dialog =
  | { kind: 'sendBack'; row: ProductRow }
  | { kind: 'delete'; rows: ProductRow[] }
  | { kind: 'collection'; ids: string[]; options: { value: string; label: string }[] }
  | { kind: 'tax'; ids: string[]; options: { value: string; label: string }[] }

// The harness's seats for this screen alone; the shell's ?as= still sets the menu.
const forcedAccess = (state: ProductListState | null, live: ProductAccess): ProductAccess => {
  if (state === 'readOnly') return accessOf({ permissions: ['catalog.read', 'catalog.write', 'approve', 'manage-vendors'], seller: null }, true)
  if (state === 'staff') return accessOf({ permissions: ['catalog.read'], seller: null }, false)
  if (state === 'supplier' || state === 'supplierEmpty') return accessOf({ permissions: ['catalog.read', 'catalog.propose'], seller: {} }, false)
  if (state) return accessOf({ permissions: ['catalog.read', 'catalog.write', 'approve', 'manage-vendors'], seller: null }, false)
  return live
}

/** Products (CatList, FIRST-RELEASE §11): the merchant's catalogue, or a supplier's own; ?state= per productListStates.ts. */
export const ProductList = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(productListStates, harnessEnabled)
  const sample = useMemo(() => productListSample(forced), [forced])
  const access = useMemo(() => forcedAccess(forced, accessOf(acting, state?.readOnly ?? false)), [forced, acting, state])
  const phone = usePhone()

  const [query, setQuery] = useState<ProductQuery>(firstQuery)
  const [cursor, setCursor] = useState<Cursor>({})
  const [pageIndex, setPageIndex] = useState(0)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return setView({ kind: 'ready', page: { rows: sample.rows, next: null, previous: null }, counts: sample.counts })
    void Promise.all([loadProducts(query, cursor), loadProductCounts()]).then(
      ([page, counts]) => {
        if (mine !== latest.current) return
        // A later page emptied by a delete or an approval: back to the first, never "No products match".
        if (page.rows.length === 0 && (cursor.after || cursor.before)) {
          setCursor({})
          setPageIndex(0)
          return
        }
        setView({ kind: 'ready', page, counts })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, query, cursor])

  useEffect(load, [load])

  // A phone has no supplier filter (CatList), so one chosen on a wider screen is cleared rather than hidden.
  useEffect(() => {
    if (!phone || query.supplier === '') return
    setQuery((current) => ({ ...current, supplier: '' }))
    setCursor({})
    setPageIndex(0)
  }, [phone, query.supplier])

  useEffect(() => {
    if (sample) return setSuppliers(sample.suppliers)
    if (!access.seeSuppliers) return
    // The filter is a convenience: without it the list still shows every supplier's products.
    void loadSupplierChoices().then(setSuppliers, () => setSuppliers([]))
  }, [sample, access.seeSuppliers])

  const change = (next: Partial<ProductQuery>) => {
    setQuery((current) => ({ ...current, ...next }))
    setCursor({})
    setPageIndex(0)
    setSelected(new Set())
    setReviewing(null)
  }

  const rows = view.kind === 'ready' ? view.page.rows : []

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      setToast(await work())
      setSelected(new Set())
      setReviewing(null)
    } catch {
      setToast(words.failed)
    } finally {
      setBusy(false)
      load()
    }
  }

  const approve = (targets: ProductRow[]) =>
    void run(async () => {
      let done = 0
      try {
        for (const row of targets) {
          await approveProduct(row.id)
          done++
        }
      } catch (error) {
        // Those approved before the failure are live: say so, rather than that nothing changed.
        if (done === 0) throw error
        return fill(words.review.approvedSome, { done: formatCount(done), count: formatCount(targets.length) })
      }
      const [only] = targets
      return targets.length === 1 && only ? fill(words.review.approved, { name: only.name, supplier: only.supplier?.name ?? '' }) : fill(words.review.approvedMany, { count: formatCount(targets.length) })
    })

  const chosen = rows.filter((r) => selected.has(r.id))
  const chosenIds = chosen.map((r) => r.id)
  const waiting = chosen.filter((r) => r.approval === 'pending')

  const show = () =>
    void run(async () => {
      const ok = chosen.filter((r) => r.approval !== 'pending').map((r) => r.id)
      const done = ok.length > 0 ? await setProductsVisible(ok, true) : 0
      return fill(plural(words.bulk.shown, done), { count: formatCount(done) }) + (ok.length < chosen.length ? words.bulk.shownSkipped : '')
    })

  const hide = () =>
    void run(async () => {
      const done = await setProductsVisible(chosenIds, false)
      return fill(plural(words.bulk.hidden, done), { count: formatCount(done) })
    })

  const pickCollection = () =>
    void loadHandPicked().then(
      (collections) =>
        collections.length === 0 ? setToast(words.bulk.collectionNone) : setDialog({ kind: 'collection', ids: chosenIds, options: collections.map((c) => ({ value: c.id, label: c.name })) }),
      () => setToast(words.failed),
    )

  const pickTax = () =>
    void loadTaxClasses().then(
      (classes) => (classes.length === 0 ? setToast(words.bulk.taxNone) : setDialog({ kind: 'tax', ids: chosenIds, options: classes.map((c) => ({ value: c.id, label: c.name })) })),
      () => setToast(words.failed),
    )

  const page = (next: Cursor, step: number) => {
    setCursor(next)
    setPageIndex((index) => Math.max(0, index + step))
    setSelected(new Set())
    setReviewing(null)
  }

  const togglePage = () => setSelected((current) => (rows.every((r) => current.has(r.id)) ? new Set([...current].filter((id) => !rows.some((r) => r.id === id))) : new Set([...current, ...rows.map((r) => r.id)])))
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const title = access.supplier ? words.titleSupplier : access.viewOnly ? words.titleViewOnly : words.title
  const filtered = query.filter !== 'all' || query.search !== '' || query.supplier !== ''
  const isEmpty = view.kind === 'ready' && view.counts.all === 0 && !filtered

  if (isEmpty && !access.supplier)
    return (
      <div className="df-products">
        <h1 className="df-visually-hidden">{title}</h1>
        <ProductsEmpty canAdd={access.canEdit} />
      </div>
    )

  const pager = view.kind === 'ready' && (
    <nav className="df-products-pager" aria-label={words.pages.label}>
      <span>{fill(words.pages.showing, { from: formatCount(pageIndex * productPageSize + 1), to: formatCount(pageIndex * productPageSize + rows.length) })}</span>
      <span>
        <button type="button" className="df-button" disabled={!view.page.previous} onClick={() => page({ before: view.page.previous }, -1)}>
          {words.pages.previous}
        </button>
        <button type="button" className="df-button" disabled={!view.page.next} onClick={() => page({ after: view.page.next }, 1)}>
          {words.pages.next}
        </button>
      </span>
    </nav>
  )

  const addLink = (
    <Link className="df-button df-button--primary" to="/products/$productId" params={{ productId: 'new' }}>
      {words.add}
    </Link>
  )

  return (
    <div className="df-products">
      <div className="df-products-head">
        <div>
          <h1 className="df-page-title">{title}</h1>
          {view.kind === 'ready' && <p className="df-page-lede">{summaryOf(view.counts, access.supplier)}</p>}
        </div>
        {access.canEdit && !phone && <div className="df-products-head-actions">{addLink}</div>}
      </div>

      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}

      {view.kind === 'ready' && isEmpty && <EmptyState title={words.supplierEmpty.title} body={words.supplierEmpty.body} action={access.canEdit ? addLink : undefined} />}

      {view.kind === 'ready' && !isEmpty && (
        <>
          {access.canApprove && view.counts.pending > 0 && query.filter !== 'pending' && (
            <div className="df-products-banner">
              <span>
                <strong>{fill(plural(words.banner.waiting, view.counts.pending), { count: formatCount(view.counts.pending) })}</strong> {words.banner.waitingBody}
              </span>
              <button type="button" className="df-button" onClick={() => change({ filter: 'pending' })}>
                {words.banner.waitingCta}
              </button>
            </div>
          )}

          <div className="df-products-toolbar">
            <SearchField label={words.search.label} placeholder={words.search.placeholder} value={query.search || undefined} onChange={(search) => change({ search: search ?? '' })} />
            {access.seeSuppliers && !phone && (
              <FilterSelect
                label={words.supplier.label}
                anyLabel={words.supplier.all}
                options={[{ value: 'own', label: words.supplier.own }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
                value={query.supplier || undefined}
                onChange={(supplier) => change({ supplier: supplier ?? '' })}
              />
            )}
            <label className="df-list-select">
              <span>{words.sort.label}</span>
              <select value={query.sort} onChange={(event) => change({ sort: productSorts.find((s) => s === event.target.value) ?? 'updated' })}>
                {productSorts.map((sort: ProductSort) => (
                  <option key={sort} value={sort}>
                    {words.sort[sort]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="df-products-chips" role="group" aria-label={words.chips.label}>
            {productFilters
              .filter((f) => f === 'all' || f === query.filter || view.counts[countOf[f]] > 0)
              .map((f) => (
                <button key={f} type="button" className="df-products-chip" aria-pressed={query.filter === f} onClick={() => change({ filter: f })}>
                  {words.chips[f]}
                  <span>{formatCount(view.counts[countOf[f]])}</span>
                </button>
              ))}
          </div>

          {access.canSelect && !phone && chosen.length > 0 && (
            <div className="df-products-bulk" role="toolbar" aria-label={fill(words.bulk.selected, { count: formatCount(chosen.length) })}>
              <strong>{chosen.length === rows.length ? fill(words.bulk.allSelected, { count: formatCount(chosen.length) }) : fill(words.bulk.selected, { count: formatCount(chosen.length) })}</strong>
              <span className="df-products-bulk-gap" />
              {access.canApprove && waiting.length > 0 && (
                <button type="button" className="df-products-bulk-approve" disabled={busy} onClick={() => approve(waiting)}>
                  {fill(words.bulk.approve, { count: formatCount(waiting.length) })}
                </button>
              )}
              <button type="button" disabled={busy} onClick={show}>
                {words.bulk.show}
              </button>
              <button type="button" disabled={busy} onClick={hide}>
                {words.bulk.hide}
              </button>
              <button type="button" disabled={busy} onClick={pickCollection}>
                {words.bulk.addToCollection}
              </button>
              <button type="button" disabled={busy} onClick={pickTax}>
                {words.bulk.taxClass}
              </button>
              <button type="button" className="df-products-bulk-delete" disabled={busy} onClick={() => setDialog({ kind: 'delete', rows: chosen })}>
                {words.bulk.delete}
              </button>
              <button type="button" className="df-products-bulk-clear" onClick={() => setSelected(new Set())}>
                {words.bulk.clear}
              </button>
            </div>
          )}

          {rows.length === 0 ? (
            <section className="df-state" aria-labelledby="df-products-none">
              <h2 id="df-products-none">{query.search ? fill(words.noResults.search, { search: query.search }) : words.noResults.filters}</h2>
              <p>{words.noResults.body}</p>
              <div className="df-actions">
                <button type="button" className="df-button" onClick={() => change(firstQuery)}>
                  {words.noResults.clear}
                </button>
              </div>
            </section>
          ) : (
            <>
              {phone ? (
                <ProductCards rows={rows} access={access} selected={selected} reviewing={reviewing} busy={busy} onToggle={toggle} onTogglePage={togglePage} onReview={setReviewing} onApprove={(row) => approve([row])} onSendBack={(row) => setDialog({ kind: 'sendBack', row })} footer={pager} />
              ) : (
                <ProductTable rows={rows} access={access} selected={selected} reviewing={reviewing} busy={busy} onToggle={toggle} onTogglePage={togglePage} onReview={setReviewing} onApprove={(row) => approve([row])} onSendBack={(row) => setDialog({ kind: 'sendBack', row })} footer={pager} />
              )}

            </>
          )}
        </>
      )}

      {access.canEdit && phone && !isEmpty && (
        <Link className="df-products-fab" to="/products/$productId" params={{ productId: 'new' }}>
          {words.addFab}
        </Link>
      )}

      {dialog && (
        <ProductDialog
          dialog={dialog}
          onDone={(work) => {
            setDialog(null)
            if (work) void run(work)
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

const choiceFrom = (key: string, label: string, options: { value: string; label: string }[]) => ({ key, label, options, initial: options[0]?.value ?? '', error: (picked: string) => (picked ? null : label) })

/** One dialog at a time: send back with a reason, delete, or pick a collection or tax category. `onDone` gets the work, or nothing for Cancel. */
const ProductDialog = ({ dialog, onDone }: { dialog: Dialog; onDone: (work: (() => Promise<string>) | null) => void }) => {
  const shared = { open: true, cancelLabel: words.cancel, onCancel: () => onDone(null) }
  const props: ConfirmDialogProps = (() => {
    switch (dialog.kind) {
      case 'sendBack': {
        const supplier = dialog.row.supplier?.name ?? ''
        return {
          ...shared,
          title: fill(words.review.sendBackTitle, { supplier }),
          target: dialog.row.name,
          consequence: words.review.sendBackBody,
          confirmLabel: words.review.sendBack,
          reason: { label: words.review.reasonLabel, hint: words.review.reasonMissing, placeholder: words.review.reasonPlaceholder },
          onConfirm: (reason) =>
            onDone(async () => {
              await sendBackProduct(dialog.row.id, reason ?? '')
              return fill(words.review.sentBack, { supplier })
            }),
        }
      }
      case 'delete': {
        const [only] = dialog.rows
        const names = dialog.rows.map((r) => r.name)
        return {
          ...shared,
          danger: true,
          title: dialog.rows.length === 1 && only ? fill(words.bulk.deleteTitleOne, { name: only.name }) : fill(words.bulk.deleteTitle, { count: formatCount(dialog.rows.length) }),
          target: names.join(', '),
          consequence: words.bulk.deleteBody,
          confirmLabel: words.bulk.deleteConfirm,
          onConfirm: () =>
            onDone(async () => {
              const done = await deleteProducts(dialog.rows.map((r) => r.id))
              return fill(plural(words.bulk.deleted, done), { count: formatCount(done) })
            }),
        }
      }
      case 'collection':
        return {
          ...shared,
          title: fill(words.bulk.collectionTitle, { count: formatCount(dialog.ids.length) }),
          target: words.bulk.addToCollection,
          consequence: words.bulk.collectionBody,
          confirmLabel: words.bulk.collectionConfirm,
          choices: [choiceFrom('collection', words.bulk.collectionLabel, dialog.options)],
          onConfirm: (_, __, picks) =>
            onDone(async () => {
              const id = picks.collection ?? ''
              await addToCollection(id, dialog.ids)
              return fill(words.bulk.collectionAdded, { name: dialog.options.find((o) => o.value === id)?.label ?? '' })
            }),
        }
      case 'tax':
        return {
          ...shared,
          title: fill(words.bulk.taxTitle, { count: formatCount(dialog.ids.length) }),
          target: words.bulk.taxClass,
          consequence: words.bulk.taxBody,
          confirmLabel: words.bulk.taxConfirm,
          choices: [choiceFrom('taxClass', words.bulk.taxLabel, dialog.options)],
          onConfirm: (_, __, picks) =>
            onDone(async () => {
              const id = picks.taxClass ?? ''
              const done = await setTaxClass(dialog.ids, id)
              return fill(words.bulk.taxApplied, { count: formatCount(done), name: dialog.options.find((o) => o.value === id)?.label ?? '' })
            }),
        }
    }
  })()
  return <ConfirmDialog {...props} />
}
