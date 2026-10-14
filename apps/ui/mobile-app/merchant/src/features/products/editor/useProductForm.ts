import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { adjustStock, type AdjustReason, type StockLevel, type Warehouse } from '../../../api/inventory'
import type { EditorProduct, SavedProduct } from '../../../api/products'
import { isApiError, type ApiClient } from '../../../graphql'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { tCount } from '../../../messages/plural'
import { formatNumber } from '../../../format'
import { useFeedback } from '../../shell/Feedback'
import { useShell } from '../../shell/ShellData'
import { productAccessOf } from '../access'
import { productHref } from '../routes'
import { blankDraft, draftOf, hidesEveryVersion, isDirty, isFree, problemsOf, versionKey, type Draft, type DraftProblem, type DraftVersion } from './draft'
import type { SaveFailure } from './editorBanners'
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
  const [first] = useState(() => (data.product ? draftOf(data.product, data.currency, data.levels) : blankDraft()))
  const [draft, setDraft] = useState<Draft>(first)
  const [baseline, setBaseline] = useState<Draft>(first)
  const [levels, setLevels] = useState<Map<string, StockLevel[]>>(data.levels)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [exit, setExit] = useState<(() => void) | null>(null)

  const readOnly = state?.readOnly === true
  const kindLocked = current !== null && current.productType !== 'physical'
  const access = productAccessOf(data.access, readOnly, isNew)
  const canEdit = access.canEdit && !kindLocked
  const canStock = access.canStock && !kindLocked
  const dirty = isDirty(draft, baseline)
  const problems = problemsOf(draft, data.currency)
  const shown: DraftProblem[] = attempted ? (canEdit ? problems : problems.filter((problem) => problem === 'stock')) : []

  const update = useCallback<Update>((change) => setDraft(change), [])

  // Navigation waits for a render that no longer holds the screen back, or the guard would stop its own way out.
  useEffect(() => {
    exit?.()
  }, [exit])

  const perform = async () => {
    setSaving(true)
    setFailure(null)
    try {
      const out = await runSave({ client, product: current, draft, baseline, currency: data.currency, side: access.side, propose: access.proposes && isNew, writesProduct: canEdit, countsStock: canStock })
      feedback.toast({ message: savedWords(out.saved, access.side, isNew, draft.name.trim()) })
      refresh()
      if (isNew) {
        setBaseline(draft)
        if (out.stockFailed) feedback.toast({ message: t('products.stock.newFailed') })
        return setExit(() => () => router.replace(productHref(seat, out.id) as never))
      }
      if (!out.product) return onReload()
      const fresh = draftOf(out.product, data.currency, out.levels ?? levels)
      setCurrent(out.product)
      if (out.levels) setLevels(out.levels)
      setBaseline(fresh)
      setDraft(out.stockFailed ? { ...fresh, stock: draft.stock } : fresh)
      if (out.stockFailed) setFailure({ code: null, message: t('products.stock.failed') })
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

  const discard = () => {
    setDraft(baseline)
    setFailure(null)
    setAttempted(false)
  }

  return { current, isNew, access, canEdit, canStock, kindLocked, readOnly, draft, update, dirty, levels, saving, failure, problems, shown, save, adjust, discard, leave: (go: () => void) => setExit(() => go), leaving: exit !== null }
}
