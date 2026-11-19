import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import {
  archiveStoreCategory,
  categoryManagers,
  categoryRefusals,
  createStoreCategory,
  englishName,
  addDefaultStoreCategorySample,
  removeStoreCategorySample,
  updateStoreCategory,
  type SampleProblem,
  type StoreCategory,
} from '../../api/storeCategories'
import { isApiError } from '../../api/client'
import { fill, messages } from '../../messages'
import { ConfirmDialog, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { CategoryFields } from './CategoryFields'
import { emptyForm, formOf, formProblem, inputOf, type CategoryForm } from './categoryForm'
import { SampleProblems } from './SampleFields'
import { StoreCategories, StoreCategoriesError, storeCountText, type CategoryAction } from './StoreCategories'
import { storeCategoriesStates } from './storeCategoriesHarness'

const listRoute = getRouteApi('/_app/categories')
const appRoute = getRouteApi('/_app')
const words = messages.storeCategories

type Pending = { kind: 'add' } | { kind: CategoryAction; category: StoreCategory }

export const refusalText = (failure: unknown): string =>
  isApiError(failure) && (categoryRefusals as readonly string[]).includes(failure.code) ? words.refusals[failure.code as (typeof categoryRefusals)[number]] : words.refusals.other

// What each dialog says; the add and edit ones carry the form, archive states how many stores keep it.
export const categoryDialog = (pending: Pending) => {
  if (pending.kind === 'add') return { title: words.form.addTitle, target: '', consequence: words.form.addConsequence, confirmLabel: words.form.addConfirm, danger: false, form: true, sample: false }
  const name = englishName(pending.category)
  if (pending.kind === 'edit') return { title: fill(words.form.editTitle, { name }), target: '', consequence: words.form.editConsequence, confirmLabel: words.form.editConfirm, danger: false, form: true, sample: false }
  if (pending.kind === 'addDefaultSample')
    return { title: fill(pending.category.sample ? words.sample.resetTitle : words.sample.addDefaultTitle, { name }), target: name, consequence: fill(words.sample.addDefaultConsequence, { name }), confirmLabel: pending.category.sample ? words.sample.reset : words.sample.addDefault, danger: false, form: false, sample: true }
  if (pending.kind === 'removeSample')
    return { title: fill(words.sample.removeTitle, { name }), target: name, consequence: words.sample.removeConsequence, confirmLabel: words.sample.removeConfirm, danger: true, form: false, sample: false }
  if (pending.kind === 'archive')
    return { title: fill(words.archiveDialog.title, { name }), target: name, consequence: fill(words.archiveDialog.consequence, { stores: storeCountText(pending.category.storeCount) }), confirmLabel: words.archiveDialog.confirm, danger: true, form: false, sample: false }
  return { title: fill(words.restoreDialog.title, { name }), target: name, consequence: words.restoreDialog.consequence, confirmLabel: words.restoreDialog.confirm, danger: false, form: false, sample: false }
}

class SampleRefused extends Error {}

export const StoreCategoriesScreen = () => {
  const categories = listRoute.useLoaderData()
  const { me } = appRoute.useLoaderData()
  const forced = useScreenState(storeCategoriesStates, harnessEnabled)
  const router = useRouter()
  const [pending, setPending] = useState<Pending | null>(forced === 'confirm' ? { kind: 'add' } : null)
  const [form, setForm] = useState<CategoryForm>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [problems, setProblems] = useState<readonly SampleProblem[]>([])
  const clearToast = useCallback(() => setToast(null), [])

  const open = (next: Pending) => {
    setForm(next.kind === 'edit' ? formOf(next.category) : emptyForm)
    setProblems([])
    setError(null)
    setPending(next)
  }
  const close = () => {
    setPending(null)
    setError(null)
  }

  const save = async (current: Pending, reason: string): Promise<string> => {
    if (current.kind === 'add') return fill(words.done.created, { name: englishName(await createStoreCategory(inputOf(form), reason)) })
    if (current.kind === 'edit') return fill(words.done.updated, { name: englishName(await updateStoreCategory(current.category.id, inputOf(form), reason)) })
    if (current.kind === 'addDefaultSample') {
      const saved = await addDefaultStoreCategorySample(current.category.id, reason)
      // Problems keep the dialog open, listed by line; the built-in data then needs a fix in the repo.
      if (!saved.category) {
        setProblems(saved.problems)
        throw new SampleRefused()
      }
      return fill(words.sample.saved, { name: englishName(saved.category) })
    }
    if (current.kind === 'removeSample') return fill(words.sample.removed, { name: englishName(await removeStoreCategorySample(current.category.id, reason)) })
    const archived = current.kind === 'archive'
    const saved = await archiveStoreCategory(current.category.id, archived, reason)
    return fill(archived ? words.done.archived : words.done.restored, { name: englishName(saved) })
  }

  const onConfirm = (reason: string | null) => {
    if (!pending) return
    setError(null)
    save(pending, reason ?? '')
      .then((done) => {
        close()
        setToast(done)
        void router.invalidate()
      })
      .catch((failure: unknown) => setError(failure instanceof SampleRefused ? words.sample.refused : refusalText(failure)))
  }

  const dialog = pending ? categoryDialog(pending) : null
  return (
    <>
      <StoreCategories
        categories={categories}
        forced={forced}
        canManage={categoryManagers.includes(me.role)}
        onAdd={() => open({ kind: 'add' })}
        onAction={(kind, category) => open({ kind, category })}
        onReload={() => void router.invalidate()}
      />
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        target={dialog?.target ?? ''}
        consequence={dialog?.consequence ?? ''}
        confirmLabel={dialog?.confirmLabel ?? ''}
        cancelLabel={words.cancel}
        reason={{ label: words.reason.label, hint: words.reason.hint }}
        danger={dialog?.danger ?? false}
        wide={dialog?.form ?? false}
        blocked={dialog?.form ? formProblem(form) : null}
        error={error}
        onConfirm={onConfirm}
        onCancel={close}
      >
        {dialog?.form && <CategoryFields value={form} onChange={setForm} />}
        {dialog?.sample && <SampleProblems problems={problems} />}
      </ConfirmDialog>
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const StoreCategoriesRouteError = () => {
  const router = useRouter()
  return <StoreCategoriesError onRetry={() => void router.invalidate()} />
}
