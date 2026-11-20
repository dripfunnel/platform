import { getRouteApi, Link, useBlocker, useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { categoryManagers, englishName, type SampleProblem, type StoreCategory } from '../../api/storeCategories'
import { saveStoreCategorySampleItems, uploadSamplePhoto, type SampleDetail } from '../../api/storeCategorySample'
import { fill, formatDate, messages } from '../../messages'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, plainTextOf, ReadOnlyNotice, Toast } from '@dripfunnel/shared/ui'
import { SampleProblems } from './SampleFields'
import { SamplePhotoField, SampleThumb } from './SamplePhotoField'
import { SampleProductFields } from './SampleProductFields'
import {
  addCollection,
  collectionProblem,
  draftOf,
  draftProblem,
  dropCollection,
  dropProduct,
  emptyProduct,
  inputOf,
  maxCollections,
  maxProducts,
  productProblem,
  productsIn,
  putProduct,
  renameCollection,
  sameDraft,
  setCollectionPhoto,
  type DraftProduct,
  type SampleDraft,
} from './sampleDraft'
import { refusalText } from './StoreCategoriesScreen'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import './storeCategories.css'

const words = messages.storeCategories.editor
const editorRoute = getRouteApi('/_app/categories_/$categoryId_/sample')
const appRoute = getRouteApi('/_app')

const Breadcrumb = ({ current }: { current?: string }) => (
  <nav aria-label={words.back} className="df-breadcrumb">
    <Link to="/categories">{words.back}</Link>
    {current && (
      <>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{current}</span>
      </>
    )}
  </nav>
)

export const SampleEditorLoading = () => (
  <div className="df-page">
    <Breadcrumb />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const SampleEditorRouteError = () => {
  const router = useRouter()
  return (
    <div className="df-page">
      <Breadcrumb />
      <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => void router.invalidate() }} />
    </div>
  )
}

type Dialog =
  | { kind: 'product'; product: DraftProduct; isNew: boolean }
  | { kind: 'dropProduct'; product: DraftProduct }
  | { kind: 'addCollection' }
  | { kind: 'renameCollection'; name: string }
  | { kind: 'dropCollection'; name: string }
  | { kind: 'save' }

export const SampleEditorScreen = () => {
  const { category, detail } = editorRoute.useLoaderData()
  const { me } = appRoute.useLoaderData()
  const canManage = me !== null && categoryManagers.includes(me.role)
  if (!category) return <EmptyState title={words.notFound.title} body={words.notFound.body} />
  return <SampleEditor category={category} detail={detail} canManage={canManage} />
}

export interface SampleEditorProps {
  category: StoreCategory
  detail: SampleDetail | null
  canManage: boolean
}

/** A category's sample catalog: every role sees its products and collections; Super admin edits them and saves with a reason. */
export const SampleEditor = ({ category, detail, canManage }: SampleEditorProps) => {
  const router = useRouter()
  const name = englishName(category)
  const loaded = useRef(draftOf(detail, category.sample?.currency))
  const [draft, setDraft] = useState<SampleDraft>(loaded.current)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [working, setWorking] = useState<DraftProduct | null>(null)
  const [problems, setProblems] = useState<SampleProblem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const leaving = useRef(false)
  const dirty = !sameDraft(draft, loaded.current)
  useBlocker({ shouldBlockFn: () => dirty && !leaving.current && !window.confirm(words.leave), enableBeforeUnload: () => dirty && !leaving.current })

  const close = () => {
    setDialog(null)
    setWorking(null)
    setError(null)
    setProblems([])
  }
  const openProduct = (product: DraftProduct, isNew: boolean) => {
    setWorking(product)
    setDialog({ kind: 'product', product, isNew })
  }

  const confirm = (reason: string | null, value: string | null) => {
    if (!dialog) return
    switch (dialog.kind) {
      case 'product':
        if (working) setDraft((d) => putProduct(d, working))
        return close()
      case 'dropProduct':
        setDraft((d) => dropProduct(d, dialog.product.key))
        return close()
      case 'addCollection':
        setDraft((d) => addCollection(d, value ?? ''))
        return close()
      case 'renameCollection':
        setDraft((d) => renameCollection(d, dialog.name, value ?? ''))
        return close()
      case 'dropCollection':
        setDraft((d) => dropCollection(d, dialog.name))
        return close()
      case 'save':
        setError(null)
        setProblems([])
        void saveStoreCategorySampleItems(category.id, inputOf(draft), reason ?? '').then(
          (answer) => {
            if (!answer.saved) {
              setProblems(answer.problems)
              setError(words.refused)
              return
            }
            leaving.current = true
            loaded.current = draft
            close()
            setToast(fill(words.saved, { name }))
            void router.invalidate().finally(() => (leaving.current = false))
          },
          (failure: unknown) => setError(refusalText(failure)),
        )
    }
  }

  const blocked = draftProblem(draft)
  const dialogProps = (() => {
    if (!dialog) return null
    switch (dialog.kind) {
      case 'product':
        return {
          title: dialog.isNew ? words.addProductTitle : fill(words.editProductTitle, { name: dialog.product.name }),
          consequence: words.productConsequence,
          confirmLabel: dialog.isNew ? words.addProduct : words.done,
          wide: true,
          blocked: working ? productProblem(draft, working) : null,
        }
      case 'dropProduct':
        return { title: fill(words.dropProductTitle, { name: dialog.product.name }), consequence: words.dropProductConsequence, confirmLabel: words.dropProduct, danger: true }
      case 'addCollection':
        return {
          title: words.addCollectionTitle,
          consequence: words.collectionConsequence,
          confirmLabel: words.addCollection,
          input: { label: words.collectionName, type: 'text' as const, initial: '', error: (v: string) => collectionProblem(draft, v) },
        }
      case 'renameCollection':
        return {
          title: fill(words.renameCollectionTitle, { name: dialog.name }),
          consequence: words.collectionConsequence,
          confirmLabel: words.renameCollection,
          input: { label: words.collectionName, type: 'text' as const, initial: dialog.name, error: (v: string) => collectionProblem(draft, v, dialog.name) },
        }
      case 'dropCollection':
        return {
          title: fill(words.dropCollectionTitle, { name: dialog.name }),
          consequence: fill(words.dropCollectionConsequence, { count: String(productsIn(draft, dialog.name)) }),
          confirmLabel: words.dropCollection,
          danger: true,
        }
      case 'save':
        return { title: fill(words.saveTitle, { name }), consequence: words.saveConsequence, confirmLabel: words.save, reason: true }
    }
  })()

  const status = detail ? fill(words.status, { count: String(draft.products.length), collections: String(draft.collections.length), currency: draft.currency, date: formatDate(detail.uploadedAt) }) : words.noSample

  return (
    <div className="df-page df-sample-editor">
      <Breadcrumb current={name} />
      <div className="df-sample-head">
        <div>
          <h1>{fill(words.title, { name })}</h1>
          <p className="df-field-hint">{status}</p>
        </div>
        {canManage && (
          <button type="button" className="df-button df-button--primary" disabled={!dirty || blocked !== null} onClick={() => setDialog({ kind: 'save' })}>
            {words.save}
          </button>
        )}
      </div>
      {!canManage && <ReadOnlyNotice title={words.readOnly.title} body={words.readOnly.body} />}
      {canManage && dirty && (
        <p className="df-sample-unsaved" role="status">
          {blocked ?? words.unsaved}
        </p>
      )}

      {canManage && (
        <div className="df-field df-sample-currency">
          <label htmlFor="df-sample-currency">{words.currency}</label>
          <input id="df-sample-currency" type="text" maxLength={3} value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} />
          <p className="df-field-hint">{words.currencyHint}</p>
        </div>
      )}

      <section className="df-sample-section" aria-labelledby="df-sample-products">
        <div className="df-sample-section-head">
          <h2 id="df-sample-products">{fill(words.productsTitle, { count: String(draft.products.length) })}</h2>
          {canManage && (
            <button type="button" className="df-button df-button--small" disabled={draft.products.length >= maxProducts || draft.collections.length === 0} onClick={() => openProduct(emptyProduct(draft.collections), true)}>
              {words.addProduct}
            </button>
          )}
        </div>
        {draft.collections.length === 0 && canManage && <p className="df-field-hint">{words.collectionFirst}</p>}
        {draft.products.length === 0 ? (
          <p className="df-field-hint">{words.noProducts}</p>
        ) : (
          <div className="df-table-wrap">
            <table className="df-table">
              <thead>
                <tr>
                  <th scope="col">{words.columns.photo}</th>
                  <th scope="col">{words.columns.name}</th>
                  <th scope="col">{words.columns.sku}</th>
                  <th scope="col">{words.columns.price}</th>
                  <th scope="col">{words.columns.stock}</th>
                  <th scope="col">{words.columns.visible}</th>
                  <th scope="col">{words.columns.collections}</th>
                  {canManage && <th scope="col">{words.columns.actions}</th>}
                </tr>
              </thead>
              <tbody>
                {draft.products.map((p) => (
                  <tr key={p.key}>
                    <td>
                      <SampleThumb photo={p.photos[0]} alt={fill(words.photoAlt, { name: p.name })} />
                    </td>
                    <td>
                      <strong>{p.name}</strong>
                      {p.description && <div className="df-field-hint df-sample-description">{plainTextOf(p.description)}</div>}
                    </td>
                    <td>{p.sku}</td>
                    <td>{`${p.price} ${draft.currency}`}</td>
                    <td>{p.stock === '' ? words.notTracked : p.stock}</td>
                    <td>{p.visible ? words.visibleYes : words.visibleNo}</td>
                    <td>{p.collections.join(', ')}</td>
                    {canManage && (
                      <td>
                        <div className="df-category-actions">
                          <button type="button" className="df-button df-button--small" aria-label={`${words.editProduct}: ${p.name}`} onClick={() => openProduct({ ...p }, false)}>
                            {words.editProduct}
                          </button>
                          <button type="button" className="df-button df-button--small" aria-label={`${words.dropProduct}: ${p.name}`} onClick={() => setDialog({ kind: 'dropProduct', product: p })}>
                            {words.dropProduct}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="df-sample-section" aria-labelledby="df-sample-collections">
        <div className="df-sample-section-head">
          <h2 id="df-sample-collections">{fill(words.collectionsTitle, { count: String(draft.collections.length) })}</h2>
          {canManage && (
            <button type="button" className="df-button df-button--small" disabled={draft.collections.length >= maxCollections} onClick={() => setDialog({ kind: 'addCollection' })}>
              {words.addCollection}
            </button>
          )}
        </div>
        {draft.collections.length === 0 ? (
          <p className="df-field-hint">{words.noCollections}</p>
        ) : (
          <div className="df-table-wrap">
            <table className="df-table">
              <thead>
                <tr>
                  <th scope="col">{words.columns.collection}</th>
                  <th scope="col">{words.columns.photo}</th>
                  <th scope="col">{words.columns.products}</th>
                  {canManage && <th scope="col">{words.columns.actions}</th>}
                </tr>
              </thead>
              <tbody>
                {draft.collections.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td>
                      {canManage ? (
                        <SamplePhotoField photo={draft.collectionPhotos.get(c) ?? null} name={c} onChange={(photo) => setDraft((d) => setCollectionPhoto(d, c, photo))} upload={(file) => uploadSamplePhoto(category.id, file)} />
                      ) : (
                        <SampleThumb photo={draft.collectionPhotos.get(c)} alt={fill(words.photoAlt, { name: c })} />
                      )}
                    </td>
                    <td>{productsIn(draft, c)}</td>
                    {canManage && (
                      <td>
                        <div className="df-category-actions">
                          <button type="button" className="df-button df-button--small" aria-label={`${words.renameCollection}: ${c}`} onClick={() => setDialog({ kind: 'renameCollection', name: c })}>
                            {words.renameCollection}
                          </button>
                          <button type="button" className="df-button df-button--small" aria-label={`${words.dropCollection}: ${c}`} onClick={() => setDialog({ kind: 'dropCollection', name: c })}>
                            {words.dropCollection}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={dialog !== null}
        title={dialogProps?.title ?? ''}
        target=""
        consequence={dialogProps?.consequence ?? ''}
        confirmLabel={dialogProps?.confirmLabel ?? ''}
        cancelLabel={words.cancel}
        {...(dialogProps && 'reason' in dialogProps ? { reason: { label: words.reason.label, hint: words.reason.hint } } : {})}
        {...(dialogProps && 'input' in dialogProps ? { input: dialogProps.input } : {})}
        danger={dialogProps && 'danger' in dialogProps ? dialogProps.danger : false}
        wide={dialogProps && 'wide' in dialogProps ? dialogProps.wide : false}
        blocked={dialogProps && 'blocked' in dialogProps ? dialogProps.blocked : null}
        error={error}
        onConfirm={confirm}
        onCancel={close}
      >
        {dialog?.kind === 'product' && working && (
          <SampleProductFields value={working} collections={draft.collections} currency={draft.currency} onChange={setWorking} upload={(file) => uploadSamplePhoto(category.id, file)} />
        )}
        {dialog?.kind === 'save' && <SampleProblems problems={problems} />}
      </ConfirmDialog>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
