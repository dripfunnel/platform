import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { adjustStock, type AdjustReason, type StockLevel, type Warehouse } from '../../../api/inventory'
import type { ProductKindView } from '../../../api/productKinds'
import type { EditorProduct, SavedProduct } from '../../../api/products'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { tCount } from '../../../messages/plural'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { useFeedback } from '../../shell/Feedback'
import { useShell } from '../../shell/ShellData'
import { productAccessOf } from '../access'
import { productHref } from '../routes'
import { amountsOf, blankDraft, draftOf, hidesEveryVersion, isDirty, isFree, problemsOf, versionKey, withAmounts, type Draft, type DraftProblem, type DraftVersion } from './draft'
import type { SaveFailure } from './editorBanners'
import { kindChanged, kindInputOf, kindProblemsOf, type KindProblem, type ProductKind } from './kindDetails'
import { amountLabel } from './amountLabel'
import type { EditorData } from './loadEditor'
import { runSave } from './runSave'
import { withQuantity } from './stock'

type Update = (change: (draft: Draft) => Draft) => void

const savedWords = (saved: SavedProduct | null, side: 'merchant' | 'supplier', isNew: boolean, name: string): string => {
  if (side === 'supplier') {
    if (saved?.approval === 'pending') return saved.reviewed && saved.reviewed.length > 0 ? t('products.saved.needsApproval') : t('products.saved.submitted')
    return t('products.saved.live')
  }
  return isNew ? t('products.saved.added', { name }) : t('products.saved.saved')
}

// The editor's state and what it does: the draft, what a save asks and sends, the stock change that is applied at once, and
// the way out. The API decides every figure and refusal; this holds what was typed and says what came back.
export function useProductForm(client: ApiClient, data: EditorData, onReload: () => void) {
  const feedback = useFeedback()
  const router = useRouter()
  const { seat, state, refresh } = useShell()
  const [current, setCurrent] = useState<EditorProduct | null>(data.product)
  const isNew = current === null
  const [first] = useState(() => (data.product ? draftOf(data.product, data.currency, data.levels, data.kind) : blankDraft()))
  const [storedKind, setStoredKind] = useState<ProductKindView | null>(data.kind)
  // Set when the product saved but its kind's card did not: the next save sends the card again, even if it looks unchanged.
  const [kindPending, setKindPending] = useState(false)
  const [draft, setDraft] = useState<Draft>(first)
  const [baseline, setBaseline] = useState<Draft>(first)
  const [levels, setLevels] = useState<Map<string, StockLevel[]>>(data.levels)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [exit, setExit] = useState<(() => void) | null>(null)

  const readOnly = state?.readOnly === true
  const access = productAccessOf(data.access, readOnly, isNew)
  const canEdit = access.canEdit
  const canStock = access.canStock && draft.kind === 'physical'
  const dirty = isDirty(draft, baseline)
  const draftProblems = problemsOf(draft, data.currency)
  const kindProblems: KindProblem[] = access.storeFields ? kindProblemsOf(draft.kind, draft.details) : []
  const problems = [...draftProblems, ...kindProblems]
  const shown: DraftProblem[] = attempted ? (canEdit ? draftProblems : draftProblems.filter((problem) => problem === 'stock')) : []
  const kindShown = attempted && canEdit ? kindProblems : []
  const writesKind = access.storeFields && draft.kind !== 'physical'

  const update = useCallback<Update>((change) => setDraft(change), [])

  // Navigation waits for a render that no longer holds the screen back, or the guard would stop its own way out.
  useEffect(() => {
    exit?.()
  }, [exit])

  const perform = async () => {
    setSaving(true)
    setFailure(null)
    try {
      const kindInput = writesKind && (isNew || kindPending || kindChanged(draft, baseline)) ? kindInputOf(draft.kind, draft.details) : null
      const out = await runSave({ client, product: current, draft, baseline, currency: data.currency, side: access.side, propose: access.proposes && isNew, writesProduct: canEdit, countsStock: canStock, kindInput })
      const kind = draft.kind === 'physical' ? null : (out.kind ?? storedKind)
      setStoredKind(kind)
      setKindPending(out.kindFailed !== null)
      const kindFailure: SaveFailure | null = out.kindFailed
        ? { code: isApiError(out.kindFailed.error) ? out.kindFailed.error.code : null, message: t('products.kinds.partial', { reason: errorMessage(out.kindFailed.error, 'productKind') }) }
        : null
      if (!kindFailure) feedback.toast({ message: savedWords(out.saved, access.side, isNew, draft.name.trim()) })
      refresh()
      // A new product whose kind's card failed stays here, as the product it now is, so what was typed is not lost.
      if (isNew && !(kindFailure && out.product)) {
        setBaseline(draft)
        if (kindFailure) feedback.toast({ message: kindFailure.message })
        if (out.stockFailed) feedback.toast({ message: t('products.stock.newFailed') })
        return setExit(() => () => router.replace(productHref(seat, out.id) as never))
      }
      if (!out.product) {
        if (!out.stockFailed && !kindFailure) return onReload()
        // Saved, but the read-back failed with counts or a kind's card still to send: keep what was typed, at the revision the save answered with.
        if (out.saved && current) setCurrent({ ...current, revision: out.kind?.revision ?? out.saved.revision })
        setBaseline({ ...draft, stock: baseline.stock })
        return setFailure(kindFailure ?? { code: null, message: t('products.stock.failed') })
      }
      const fresh = draftOf(out.product, data.currency, out.levels ?? levels, kind)
      setCurrent(out.product)
      if (out.levels) setLevels(out.levels)
      setBaseline(fresh)
      setDraft({ ...fresh, ...(out.stockFailed ? { stock: draft.stock } : {}), ...(kindFailure ? { details: draft.details } : {}) })
      if (kindFailure) setFailure(kindFailure)
      else if (out.stockFailed) setFailure({ code: null, message: t('products.stock.failed') })
    } catch (error) {
      setFailure({ code: isApiError(error) ? error.code : null, message: errorMessage(error, 'products') })
    } finally {
      setSaving(false)
    }
  }

  const save = () => {
    setAttempted(true)
    const blocking = canEdit ? problems : problems.filter((problem) => problem === 'stock')
    if (blocking.length > 0) {
      feedback.toast({ message: tCount('products.fixToast', blocking.length) })
      return
    }
    if (canEdit && access.storeFields && hidesEveryVersion(draft)) {
      feedback.sheet({ title: t('products.versions.hidesAllTitle'), body: t('products.versions.hidesAllBody'), confirm: t('products.versions.hideProduct'), onConfirm: () => update((d) => ({ ...d, visible: false })) })
      return
    }
    if (canEdit && isFree(draft, data.currency)) {
      feedback.sheet({ title: t('products.free.title'), body: t('products.free.body'), confirm: t('products.free.confirm'), cancel: t('products.free.fix'), onConfirm: () => perform() })
      return
    }
    void perform()
  }

  const adjust = async (version: DraftVersion, change: { warehouse: Warehouse; delta: number; reason: AdjustReason }) => {
    if (!version.id) return
    const quantity = await adjustStock(client, { versionId: version.id, warehouseId: change.warehouse.id, delta: change.delta, reason: change.reason })
    const key = versionKey(version.choices)
    const set = (d: Draft): Draft => ({ ...d, stock: { ...d.stock, [key]: { ...d.stock[key], [change.warehouse.id]: String(quantity) } } })
    setLevels((existing) => withQuantity(existing, { versionId: version.id as string, warehouse: change.warehouse, quantity }))
    setDraft(set)
    setBaseline(set)
    const delta = change.delta > 0 ? t('products.stock.deltaUp', { count: formatNumber(change.delta, locale) }) : t('products.stock.deltaDown', { count: formatNumber(Math.abs(change.delta), locale) })
    feedback.toast({ message: t('products.stock.adjusted', { delta, reason: t(`products.stock.reasons.${change.reason}`) }) })
  }

  const pickKind = (kind: ProductKind) => {
    if (kind === draft.kind) return
    const label = (amount: string) => amountLabel(amount, data.currency)
    update((d) => (kind === 'gift_card' ? withAmounts({ ...d, kind, options: [] }, amountsOf(d, data.currency), data.currency, t('products.kinds.giftCard.option'), label) : { ...d, kind }))
    if (draft.kind === 'physical') feedback.toast({ message: t('products.kind.gone') })
  }

  const discard = () => {
    setDraft(baseline)
    setFailure(null)
    setAttempted(false)
  }

  return { current, isNew, access, canEdit, canStock, readOnly, draft, update, dirty, levels, saving, failure, shown, kindShown, save, adjust, pickKind, discard, leave: (go: () => void) => setExit(() => go), leaving: exit !== null }
}
