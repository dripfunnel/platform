import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Toast, useScreenState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useBlocker, useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadApprovalRequired, loadFacets, loadProduct, loadProductBasics, loadProductCollections, loadSizeCharts, loadTaxSetup, saveProduct, setProductCollections, uploadPhoto, type EditorProduct, type ProductBasics, type TaxSetup } from '../../api/productEditor'
import { deleteProducts, loadHandPicked } from '../../api/products'
import { adjustReasons, adjustStock, loadProductStock, loadStockHistory, loadWarehouses, setStock, type StockLevel, type Warehouse } from '../../api/stock'
import { harnessEnabled } from '../../harness'
import { fill, messages, plural } from '../../messages'
import { editorAccessOf } from './access'
import { ChoicesCard, type Ask } from './ChoicesCard'
import { blankDraft, draftOf, inputOf, isDirty, problemsOf, stockChangesOf, versionKey, type Draft, type DraftProblem, type ListingSection, type Units } from '../common/productDraft'
import { BasicsCard, KindCard, PhotosCard, PriceCard, type PendingPhoto } from './EditorCards'
import { EditorSections, SidePanel } from './EditorSections'
import { CollectionsPart, ListingSections, type EditorExtras as Extras } from './ListingSections'
import { signed, StockCard, type StockHistoryView } from './StockCard'
import { editorSample, editorStates } from './editorStates'
import './editor.css'

const words = messages.editor
const shellRoute = getRouteApi('/_app')

type Loaded = { product: EditorProduct | null; currency: string; units: Units; tax: TaxSetup | null; approvalRequired: boolean; warehouses: Warehouse[]; levels: Map<string, StockLevel[]>; extras: Extras }


const sectionKeys: readonly ListingSection[] = ['specs', 'highlights', 'faqs', 'related', 'badges', 'sizeCharts']

const loadExtras = async (basics: ProductBasics, merchant: boolean, productId: string | null): Promise<Extras> => {
  const on = new Set(basics.features.filter((f) => f.enabled).map((f) => f.key))
  const shown = new Set<ListingSection>([...sectionKeys.filter((k) => on.has(k)), 'filters', 'legal'])
  // A section's choices failing to load leaves that section empty rather than the editor unusable.
  const [facets, sizeCharts, handPicked, memberships] = await Promise.all([
    loadFacets().catch(() => []),
    shown.has('sizeCharts') ? loadSizeCharts().catch(() => []) : Promise.resolve([]),
    merchant ? loadHandPicked().catch(() => []) : Promise.resolve([]),
    merchant && productId ? loadProductCollections(productId).catch(() => []) : Promise.resolve([]),
  ])
  return {
    choices: { shown, facets, sizeCharts, collections: merchant ? { handPicked, automatic: memberships.filter((m) => m.kind !== 'manual') } : null },
    badges: merchant && shown.has('badges') ? basics.badges : null,
    memberships,
  }
}
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'notFound' } | ({ kind: 'ready' } & Loaded)

const problemWords = (units: Units): Record<DraftProblem, string> => ({
  name: words.name.missing,
  price: words.price.missing,
  compare: words.price.compareLow,
  cost: words.refused.INVALID_PRICE,
  options: words.refused.OPTION_VALUES_REQUIRED,
  versions: words.refused.VERSION_CHOICES,
  tooMany: words.refused.TOO_MANY_VERSIONS,
  weight: fill(words.sections.weightInvalid, { example: words.sections.units[units].weightPlaceholder }),
  box: fill(words.sections.boxInvalid, { example: words.sections.units[units].boxPlaceholder }),
  stock: words.stock.invalid,
})

const closedHistory: StockHistoryView = { open: false, rows: null, more: false, failed: false }

// A new product's counts that didn't save ride the navigation to its own page, which loads it fresh, to be saved
// again there; history state belongs to that one navigation, so they never reach another store, seat or session.
declare module '@tanstack/react-router' {
  interface HistoryState {
    unsavedCounts?: Record<string, Record<string, string>> | undefined
  }
}

const refusalOf = (error: unknown): string => {
  if (!isApiError(error)) return words.refused.other
  const known = (words.refused as Record<string, string>)[error.code]
  return known ?? words.refused.other
}

/** The product editor (CatEditor, FIRST-RELEASE §11); `new` opens an empty one. ?state= per editorStates.ts. */
export const ProductEditor = () => {
  const shell = shellRoute.useLoaderData()
  const { productId = 'new' } = useParams({ strict: false })
  const navigate = useNavigate()
  const isNew = productId === 'new'
  const forced = useScreenState(editorStates, harnessEnabled)
  const sample = useMemo(() => editorSample(forced), [forced])
  const seat = sample ? sample.seat : shell.acting
  const access = editorAccessOf(seat, sample ? sample.readOnly : (shell.state?.readOnly ?? false), isNew)
  const supplierName = seat.seller && 'name' in (seat.seller as object) ? (seat.seller as { name: string }).name : null

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [saved, setSaved] = useState<Draft>(blankDraft)
  const [showProblems, setShowProblems] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<{ text: string; stale: boolean } | null>(null)
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [ask, setAsk] = useState<Parameters<Ask>[0] | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [history, setHistory] = useState<StockHistoryView>(closedHistory)
  const files = useRef(new Map<string, File>())
  const leaving = useRef(false)
  const carriedCounts = useRouterState({ select: (state) => state.location.state.unsavedCounts })
  const carriedRef = useRef(carriedCounts)
  carriedRef.current = carriedCounts

  const show = useCallback((loaded: Loaded) => {
    const made = loaded.product ? draftOf(loaded.product, loaded.currency, { units: loaded.units, levels: loaded.levels }) : blankDraft(loaded.units)
    const next = { ...made, collectionIds: loaded.extras.memberships.filter((m) => m.kind === 'manual').map((m) => m.id) }
    const carried = loaded.product ? carriedRef.current : undefined
    if (carried && loaded.product) {
      // Applied once: a reload of this page shows what is stored, not counts already typed back in.
      void navigate({ to: '/products/$productId', params: { productId: loaded.product.id }, replace: true, state: (prev) => ({ ...prev, unsavedCounts: undefined }) })
    }
    setDraft(carried ? { ...next, stock: { ...next.stock, ...carried } } : next)
    setSaved(next)
    setFailure(carried ? { text: words.stock.newFailed, stale: false } : null)
    setHistory(closedHistory)
    setView({ kind: 'ready', ...loaded })
  }, [navigate])

  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return sample.product === null && forced === 'notFound' ? setView({ kind: 'notFound' }) : show({ product: forced === 'new' ? null : sample.product, currency: sample.currency, units: 'metric', tax: sample.tax, approvalRequired: sample.approvalRequired, warehouses: sample.warehouses, levels: forced === 'new' ? new Map() : sample.levels, extras: sample.extras })
    const supplierSide = shell.acting.seller !== null
    void Promise.all([
      isNew ? Promise.resolve(null) : loadProduct(productId),
      loadProductBasics(),
      supplierSide ? Promise.resolve(null) : loadTaxSetup().catch(() => null),
      supplierSide ? loadApprovalRequired().catch(() => true) : Promise.resolve(false),
      loadWarehouses(),
      isNew ? Promise.resolve(new Map<string, StockLevel[]>()) : loadProductStock(productId),
    ]).then(
      async ([product, basics, tax, approvalRequired, warehouses, levels]) => {
        if (!isNew && !product) return setView({ kind: 'notFound' })
        const pricing = product?.pricingCurrency ?? basics.pricingCurrency
        if (!pricing) return setView({ kind: 'error' })
        show({ product, currency: pricing, units: basics.unitSystem, tax, approvalRequired, warehouses, levels, extras: await loadExtras(basics, !supplierSide, isNew ? null : productId) })
      },
      () => setView({ kind: 'error' }),
    )
  }, [forced, sample, show, shell.acting.seller, isNew, productId])

  useEffect(load, [load])

  const dirty = view.kind === 'ready' && isDirty(draft, saved)
  useBlocker({ shouldBlockFn: () => dirty && !leaving.current && !window.confirm(words.leave), enableBeforeUnload: () => dirty })

  const update = useCallback((change: (d: Draft) => Draft) => {
    setDraft(change)
    setFailure(null)
  }, [])

  if (view.kind === 'loading') return <LoadingState label={words.loading} />
  if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
  if (view.kind === 'notFound')
    return (
      <EmptyState
        title={words.notFound.title}
        body={words.notFound.body}
        action={
          <Link className="df-button" to="/products">
            {words.notFound.back}
          </Link>
        }
      />
    )

  const { product, currency, tax } = view
  const disabled = !access.canEdit || saving
  const problems = problemsOf(draft, currency)
  const shownProblems = showProblems ? problems : []
  const made = draft.options.length > 0 && draft.versions.some((v) => v.choices.length === draft.options.length)
  const status = isNew ? 'new' : product?.approval === 'pending' ? 'pending' : product?.approval === 'sent_back' ? 'sent_back' : draft.visible ? 'visible' : 'hidden'
  const waitsForApproval = access.side === 'supplier' && (access.proposes || view.approvalRequired)
  const saveLabel = saving ? words.saving : !access.canEdit ? words.stock.saveStock : waitsForApproval ? words.submit : isNew ? words.saveNew : words.save
  const physical = draft.kind === 'physical'
  const home = view.warehouses.find((w) => w.isDefault) ?? view.warehouses[0] ?? null

  const upload = (id: string, file: File) => {
    setPending((list) => list.map((p) => (p.id === id ? { ...p, state: 'uploading', message: null } : p)))
    void uploadPhoto(file).then((result) => {
      if (!result.ok) return setPending((list) => list.map((p) => (p.id === id ? { ...p, state: 'failed', message: words.photos.refused[result.code] } : p)))
      files.current.delete(id)
      setPending((list) => list.filter((p) => p.id !== id))
      update((d) => ({ ...d, photos: [...d.photos, { assetId: result.assetId, url: `/api/assets/${result.assetId}`, alt: '', versionChoices: null }] }))
    })
  }
  const addFiles = (chosen: File[]) => {
    const added = chosen.map((file) => ({ id: crypto.randomUUID(), file }))
    for (const a of added) files.current.set(a.id, a.file)
    setPending((list) => [...list, ...added.map((a) => ({ id: a.id, name: a.file.name, state: 'uploading' as const, message: null }))])
    for (const a of added) upload(a.id, a.file)
  }

  const idsOf = (p: EditorProduct | null) => new Map((p?.versions ?? []).map((v) => [versionKey(v.choices), v.id]))
  const { warehouses, levels } = view

  /** Typed quantities after the product, once every version has its id; then what is stored, read back. */
  const saveStock = async (stored: EditorProduct, before: Draft) => {
    if (stored.productType !== 'physical') return new Map<string, StockLevel[]>()
    const ids = idsOf(stored)
    await setStock(stockChangesOf(draft, before, (key) => ids.get(key)))
    return loadProductStock(stored.id)
  }

  const save = async () => {
    // Stock only (a Stock-only supplier's product it can't otherwise edit): only the counts need to be right.
    const blocking = access.canEdit ? problems : problems.filter((p) => p === 'stock')
    if (blocking.length > 0) {
      setShowProblems(true)
      return
    }
    // A photo still on its way isn't in the product yet; saving now would leave it out.
    if (pending.some((p) => p.state === 'uploading')) {
      setToast(words.photos.waitUpload)
      return
    }
    setSaving(true)
    setFailure(null)
    let stored: EditorProduct | null = product
    const collectionsChanged = access.storeFields && [...draft.collectionIds].sort().join() !== [...saved.collectionIds].sort().join()
    /** The hand-picked collections after the product, by its own call; answers the listing's choices with them. */
    const saveCollections = async (id: string): Promise<Extras> => {
      if (!collectionsChanged) return view.extras
      const memberships = await setProductCollections(id, draft.collectionIds)
      const collections = view.extras.choices.collections
      return { ...view.extras, memberships, choices: { ...view.extras.choices, collections: collections && { ...collections, automatic: memberships.filter((m) => m.kind !== 'manual') } } }
    }
    if (access.canEdit) {
      let done: Awaited<ReturnType<typeof saveProduct>>
      try {
        done = await saveProduct(isNew ? null : (product?.id ?? null), isNew ? null : (product?.revision ?? null), inputOf(draft, currency, access.side, view.extras.choices.shown), access.proposes)
      } catch (error) {
        setFailure({ text: refusalOf(error), stale: isApiError(error, 'STALE_REVISION') })
        setSaving(false)
        return
      }
      // Saved. From here nothing may offer to save it again as new: the form is the product at its new revision,
      // its counts still to save.
      setShowProblems(false)
      setToast(done.approval === 'pending' && access.side === 'supplier' ? words.submitted : isNew ? fill(words.savedNew, { name: draft.name.trim() }) : words.saved)
      setSaved((before) => ({ ...draft, stock: before.stock, collectionIds: before.collectionIds }))
      if (product) setView((v) => (v.kind === 'ready' && v.product ? { ...v, product: { ...v.product, revision: done.revision } } : v))
      // Read back what was stored: new versions' ids for the counts, the readiness the save changed.
      stored = await loadProduct(done.id).catch(() => null)
      if (isNew) {
        // The new product's own page loads it fresh; its first counts go first, by the ids just read.
        const counted = draft.kind === 'physical' && Object.values(draft.stock).some((byPlace) => Object.values(byPlace).some((t) => t.trim() !== ''))
        const unsavedCounts = counted ? await (stored ? saveStock(stored, saved) : Promise.reject(new Error('not read back'))).then(() => undefined, () => draft.stock) : undefined
        await saveCollections(done.id).catch(() => setToast(words.saveCollectionsFailed))
        leaving.current = true
        void navigate({ to: '/products/$productId', params: { productId: done.id }, replace: true, state: (prev) => ({ ...prev, unsavedCounts }) }).finally(() => (leaving.current = false))
        setSaving(false)
        return
      }
    } else setShowProblems(false)
    if (!stored) {
      setSaving(false)
      return
    }
    const kept = draft
    let extras = view.extras
    let collectionsFailed = false
    try {
      extras = await saveCollections(stored.id)
    } catch {
      collectionsFailed = true
    }
    try {
      show({ product: stored, currency, units: draft.units, tax, approvalRequired: view.approvalRequired, warehouses, levels: await saveStock(stored, saved), extras })
      if (!access.canEdit) setToast(words.saved)
    } catch (error) {
      // The product is saved; its counts are still typed on the page, to save again.
      show({ product: stored, currency, units: draft.units, tax, approvalRequired: view.approvalRequired, warehouses, levels, extras })
      setDraft((d) => ({ ...d, stock: kept.stock }))
      setFailure({ text: isApiError(error) && error.code !== 'NOT_CONNECTED' ? refusalOf(error) : words.stock.failed, stale: false })
    }
    if (collectionsFailed) {
      setDraft((d) => ({ ...d, collectionIds: kept.collectionIds }))
      setFailure({ text: words.saveCollectionsFailed, stale: false })
    }
    setSaving(false)
  }

  const names = new Map((product?.versions ?? []).map((v) => [v.id, v.choices.join(' / ')]))
  const listingProps = { draft, update, disabled, choices: view.extras.choices, productId: product?.id ?? null, readiness: isNew ? undefined : (product?.readiness ?? null) }

  const toggleHistory = () => {
    if (!product) return
    if (history.open) return setHistory((h) => ({ ...h, open: false }))
    setHistory((h) => ({ ...h, open: true, failed: false }))
    if (history.rows === null)
      void loadStockHistory(product.id).then(
        ({ rows, more }) => setHistory((h) => ({ ...h, rows, more })),
        () => setHistory((h) => ({ ...h, failed: true })),
      )
  }

  /** "Change with a reason" (G4): its own write, applied and logged at once, then read back into the form. */
  const adjust = (versionId: string, places: readonly Warehouse[]) => {
    const home = places.find((w) => w.isDefault) ?? places[0]
    if (!product || !home) return
    const reasonChoice = { key: 'reason', label: words.stock.adjustReason, options: adjustReasons.map((r) => ({ value: r, label: words.stock.reasons[r] })), initial: 'received', error: () => null }
    const whereChoice = { key: 'where', label: words.stock.adjustWhere, options: places.map((w) => ({ value: w.id, label: w.name })), initial: home.id, error: () => null }
    setAsk({
      title: words.stock.adjustTitle,
      target: names.get(versionId) || draft.name,
      consequence: words.stock.adjustBody,
      confirmLabel: words.apply,
      choices: places.length > 1 ? [reasonChoice, whereChoice] : [reasonChoice],
      input: { label: words.stock.adjustCount, type: 'text', initial: '', placeholder: words.stock.adjustPlaceholder, error: (value) => (/^[+\-−]?\d{1,6}$/.test(value.trim()) && Number(value.trim().replace('−', '-')) !== 0 ? null : words.stock.adjustCountError) },
      onConfirm: (_, value, picks) => {
        const delta = Number((value ?? '').trim().replace('−', '-'))
        const reason = adjustReasons.find((r) => r === picks['reason']) ?? 'counted'
        const where = picks['where'] ?? home.id
        void adjustStock(versionId, where, delta, reason)
          .then(async () => {
            const fresh = await loadProductStock(product.id)
            const key = versionKey(product.versions.find((v) => v.id === versionId)?.choices ?? [])
            // Only the location it changed: a count typed elsewhere and not yet saved stays as typed.
            const counts = Object.fromEntries((fresh.get(versionId) ?? []).filter((l) => l.warehouseId === where).map((l) => [l.warehouseId, String(l.onHand)]))
            // The count is stored now: the form and its baseline both take it, so it isn't an unsaved change.
            setDraft((d) => ({ ...d, stock: { ...d.stock, [key]: { ...d.stock[key], ...counts } } }))
            setSaved((d) => ({ ...d, stock: { ...d.stock, [key]: { ...d.stock[key], ...counts } } }))
            setView((v) => (v.kind === 'ready' ? { ...v, levels: fresh } : v))
            setHistory((h) => ({ ...h, rows: null }))
            if (history.open) void loadStockHistory(product.id).then(({ rows, more }) => setHistory((h) => ({ ...h, rows, more })), () => setHistory((h) => ({ ...h, failed: true })))
            setToast(fill(words.stock.adjusted, { delta: signed(delta), reason: words.stock.reasons[reason] }))
          })
          .catch((error: unknown) => setToast(refusalOf(error)))
      },
    })
  }

  const remove = () =>
    product &&
    setAsk({
      title: fill(words.deleteTitle, { name: product.name }),
      target: product.name,
      consequence: words.deleteBody,
      confirmLabel: words.deleteConfirm,
      danger: true,
      onConfirm: () =>
        void deleteProducts([product.id]).then(
          () => {
            leaving.current = true
            void navigate({ to: '/products' })
          },
          (error: unknown) => setToast(refusalOf(error)),
        ),
    })

  const banners: { tone: 'info' | 'warn'; title: string; body: string; action?: { label: string; run: () => void } }[] = []
  if (failure?.stale) banners.push({ tone: 'warn', title: words.banner.stale, body: words.banner.staleBody, action: { label: words.banner.reload, run: load } })
  if (showProblems && problems.length > 1) banners.push({ tone: 'warn', title: fill(plural(words.banner.fix, problems.length), { count: String(problems.length) }), body: problems.map((p) => problemWords(draft.units)[p]).join(' · ') })
  if (access.readOnlyStore) banners.push({ tone: 'warn', title: words.banner.readOnly, body: words.banner.readOnlyBody })
  if (access.side === 'supplier' && product?.approval === 'sent_back' && product.sentBackReason) banners.push({ tone: 'warn', title: words.banner.sentBack, body: fill(words.banner.sentBackBody, { reason: product.sentBackReason }) })
  if (access.side === 'merchant' && product?.supplier) banners.push({ tone: 'info', title: fill(words.banner.theirs, { supplier: product.supplier.name }), body: words.banner.theirsBody })
  if (access.side === 'supplier' && !isNew && access.canEdit) banners.push({ tone: 'info', title: words.banner.ownerToo, body: view.approvalRequired ? words.banner.ownerTooApproval : words.banner.ownerTooLive })
  if (access.side === 'supplier' && access.proposes && !isNew) banners.push({ tone: 'info', title: words.banner.stockOnly, body: words.banner.stockOnlyBody })
  if (access.viewOnly && access.side === 'merchant') banners.push({ tone: 'info', title: words.banner.viewOnly, body: words.banner.viewOnlyBody })

  return (
    <div className="df-editor">
      <div className="df-editor-top">
        <Link className="df-editor-back" to="/products">
          {supplierName ? words.backSupplier : words.back}
        </Link>
        <h1 className="df-editor-title">{draft.name.trim() || (isNew ? words.newProduct : words.untitled)}</h1>
        <span className={`df-editor-status df-editor-status--${status}`}>{words.status[status]}</span>
        <span className="df-editor-top-gap" />
        {!isNew && access.storeFields && (
          <button type="button" className="df-button df-editor-delete" disabled={saving} onClick={remove}>
            {words.delete}
          </button>
        )}
        {(access.canEdit || access.canStock) && (
          <button type="button" className="df-button df-button--primary" disabled={saving} onClick={() => void save()}>
            {saveLabel}
          </button>
        )}
      </div>

      {banners.map((b) => (
        <div key={b.title} className={`df-editor-banner df-editor-banner--${b.tone}`} role={b.tone === 'warn' ? 'alert' : undefined}>
          <span>
            <strong>{b.title}</strong> {b.body}
          </span>
          {b.action && (
            <button type="button" className="df-button" onClick={b.action.run}>
              {b.action.label}
            </button>
          )}
        </div>
      ))}

      <div className="df-editor-layout">
        <div className="df-editor-main">
          <KindCard draft={draft} update={update} disabled={disabled} />
          <PhotosCard draft={draft} update={update} disabled={disabled} pending={pending} onFiles={addFiles} onRetry={(id) => { const file = files.current.get(id); if (file) upload(id, file) }} onDismiss={(id) => { files.current.delete(id); setPending((list) => list.filter((p) => p.id !== id)) }} />
          <BasicsCard draft={draft} update={update} disabled={disabled} problems={shownProblems} />
          {!made && <PriceCard draft={draft} update={update} disabled={disabled} currency={currency} problems={shownProblems} inclusive={tax ? tax.pricesIncludeTax : null} />}
          {physical && !made && <StockCard draft={draft} update={update} canStock={access.canStock && !saving} warehouses={view.warehouses} levels={product ? (view.levels.get(product.versions[0]?.id ?? '') ?? []) : []} versionId={product?.versions[0]?.id ?? null} problems={shownProblems} history={history} onHistory={toggleHistory} onAdjust={adjust} names={names} />}
          <ChoicesCard draft={draft} update={update} disabled={disabled} currency={currency} problems={shownProblems} ask={setAsk} onToast={setToast} stock={physical ? { warehouse: home, canStock: access.canStock && !saving, levels: view.levels, history, onHistory: toggleHistory, names } : null} />
          <EditorSections
            draft={draft}
            update={update}
            disabled={disabled}
            problems={shownProblems}
            taxClasses={access.side === 'merchant' && tax ? tax.classes : null}
            storeFields={access.storeFields}
            isLive={!isNew && saved.visible && saved.slug !== draft.slug}
            afterShipping={<CollectionsPart {...listingProps} />}
            afterTax={<ListingSections {...listingProps} />}
          />
        </div>
        <SidePanel draft={draft} update={update} storeFields={access.storeFields} canShow={product?.approval !== 'pending'} readiness={isNew ? undefined : (product?.readiness ?? null)} currency={currency} inclusive={tax ? tax.pricesIncludeTax : null} approvalNote={access.side === 'supplier' && isNew && waitsForApproval} badges={view.extras.badges} />
      </div>

      {(access.canEdit || access.canStock) && (dirty || failure) && (
        <div className={failure ? 'df-editor-bar df-editor-bar--failed' : 'df-editor-bar'} role="region" aria-label={failure ? words.bar.failed : words.bar.unsaved}>
          <span>{failure ? failure.text : words.bar.unsaved}</span>
          <button type="button" className="df-button" disabled={saving} onClick={() => { setDraft(saved); setFailure(null); setShowProblems(false) }}>
            {words.bar.discard}
          </button>
          <button type="button" className="df-button df-button--primary" disabled={saving} onClick={() => void save()}>
            {saveLabel}
          </button>
        </div>
      )}

      {ask && <ConfirmDialog {...(ask as Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>)} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
