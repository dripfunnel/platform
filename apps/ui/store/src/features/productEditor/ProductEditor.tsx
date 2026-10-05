import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Toast, useScreenState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useBlocker, useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadApprovalRequired, loadProduct, loadProductBasics, loadTaxSetup, saveProduct, uploadPhoto, type EditorProduct, type TaxSetup } from '../../api/productEditor'
import { deleteProducts } from '../../api/products'
import { harnessEnabled } from '../../harness'
import { fill, messages, plural } from '../../messages'
import { editorAccessOf } from './access'
import { ChoicesCard, type Ask } from './ChoicesCard'
import { blankDraft, draftOf, inputOf, isDirty, problemsOf, type Draft, type DraftProblem, type Units } from './draft'
import { BasicsCard, KindCard, PhotosCard, PriceCard, type PendingPhoto } from './EditorCards'
import { EditorSections, SidePanel } from './EditorSections'
import { editorSample, editorStates } from './editorStates'
import './editor.css'

const words = messages.editor
const shellRoute = getRouteApi('/_app')

type Loaded = { product: EditorProduct | null; currency: string; units: Units; tax: TaxSetup | null; approvalRequired: boolean }
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
})

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
  const files = useRef(new Map<string, File>())
  const leaving = useRef(false)

  const show = useCallback((loaded: Loaded) => {
    const next = loaded.product ? draftOf(loaded.product, loaded.currency, loaded.units) : blankDraft(loaded.units)
    setDraft(next)
    setSaved(next)
    setView({ kind: 'ready', ...loaded })
  }, [])

  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return sample.product === null && forced === 'notFound' ? setView({ kind: 'notFound' }) : show({ product: forced === 'new' ? null : sample.product, currency: sample.currency, units: 'metric', tax: sample.tax, approvalRequired: sample.approvalRequired })
    const supplierSide = shell.acting.seller !== null
    void Promise.all([
      isNew ? Promise.resolve(null) : loadProduct(productId),
      loadProductBasics(),
      supplierSide ? Promise.resolve(null) : loadTaxSetup().catch(() => null),
      supplierSide ? loadApprovalRequired().catch(() => true) : Promise.resolve(false),
    ]).then(
      ([product, basics, tax, approvalRequired]) => {
        if (!isNew && !product) return setView({ kind: 'notFound' })
        const pricing = product?.pricingCurrency ?? basics.pricingCurrency
        if (!pricing) return setView({ kind: 'error' })
        show({ product, currency: pricing, units: basics.unitSystem, tax, approvalRequired })
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
  const saveLabel = saving ? words.saving : waitsForApproval ? words.submit : isNew ? words.saveNew : words.save

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

  const save = async () => {
    if (problems.length > 0 || pending.some((p) => p.state === 'uploading')) {
      setShowProblems(true)
      return
    }
    setSaving(true)
    setFailure(null)
    let done: Awaited<ReturnType<typeof saveProduct>>
    try {
      done = await saveProduct(isNew ? null : (product?.id ?? null), isNew ? null : (product?.revision ?? null), inputOf(draft, currency, access.side), access.proposes)
    } catch (error) {
      setFailure({ text: refusalOf(error), stale: isApiError(error, 'STALE_REVISION') })
      setSaving(false)
      return
    }
    // Saved. From here nothing may offer to save it again as new: the form is the product at its new revision.
    setShowProblems(false)
    setToast(done.approval === 'pending' && access.side === 'supplier' ? words.submitted : isNew ? fill(words.savedNew, { name: draft.name.trim() }) : words.saved)
    setSaved(draft)
    if (product) setView((v) => (v.kind === 'ready' && v.product ? { ...v, product: { ...v.product, revision: done.revision } } : v))
    if (isNew) {
      // The new product's own page loads it, its versions' ids and readiness included.
      leaving.current = true
      void navigate({ to: '/products/$productId', params: { productId: done.id }, replace: true }).finally(() => (leaving.current = false))
      setSaving(false)
      return
    }
    // Read back what was stored: new versions' ids, the readiness the save changed. A failed read keeps the form.
    const fresh = await loadProduct(done.id).catch(() => null)
    if (fresh) show({ product: fresh, currency, units: draft.units, tax, approvalRequired: view.approvalRequired })
    setSaving(false)
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
        {access.canEdit && (
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
          <ChoicesCard draft={draft} update={update} disabled={disabled} currency={currency} problems={shownProblems} ask={setAsk} onToast={setToast} />
          <EditorSections draft={draft} update={update} disabled={disabled} problems={shownProblems} taxClasses={access.side === 'merchant' && tax ? tax.classes : null} storeFields={access.storeFields} isLive={!isNew && saved.visible && saved.slug !== draft.slug} />
        </div>
        <SidePanel draft={draft} update={update} storeFields={access.storeFields} canShow={product?.approval !== 'pending'} readiness={isNew ? undefined : (product?.readiness ?? null)} currency={currency} inclusive={tax ? tax.pricesIncludeTax : null} approvalNote={access.side === 'supplier' && isNew && waitsForApproval} />
      </div>

      {access.canEdit && (dirty || failure) && (
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
