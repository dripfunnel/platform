import { useId, useState } from 'react'
import type { StorefrontBrand } from '../../api/storefront'
import { messages } from '../../messages'
import { BrandFields, brandFieldKeys } from './BrandFields'
import { brandComplete, brandFormOf, brandInputOf, brandProblemOf, type FormProblem } from './brandDraft'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.brand

export interface BrandCardProps {
  brand: StorefrontBrand | null
  canEdit: boolean
  api: StorefrontApi
  onSaved: (brand: StorefrontBrand, toast: string) => void
}

/** Site settings › Brand (FIRST-RELEASE §14, not drawn): the brand step's fields, saved as one section. */
export const BrandCard = ({ brand, canEdit, api, onSaved }: BrandCardProps) => {
  const id = useId()
  const [saved, setSaved] = useState(() => brandFormOf(brand))
  const [form, setForm] = useState(saved)
  const [problem, setProblem] = useState<FormProblem | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  const save = async () => {
    if (!brandComplete(form)) return setProblem({ field: form.shopName.trim() === '' ? 'shopName' : 'logo', text: words.needed })
    setBusy(true)
    setProblem(null)
    try {
      const answer = await api.saveBrand(brandInputOf(form))
      const next = brandFormOf(answer)
      setSaved(next)
      setForm(next)
      onSaved(answer, words.card.saved)
    } catch (error) {
      setProblem(brandProblemOf(error, words.refused))
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    setForm(saved)
    setProblem(null)
  }

  const above = problem && !(problem.field && brandFieldKeys.includes(problem.field))
  return (
    <section className="df-sf-card df-sf-brand" aria-labelledby={`${id}-title`}>
      <div className="df-sf-card-head">
        <h2 id={`${id}-title`}>{words.card.title}</h2>
        <p className="df-sf-lede">{words.card.lede}</p>
      </div>
      {above && (
        <p className="df-sf-failure" role="alert">
          {problem.text}
        </p>
      )}
      <BrandFields form={form} onForm={setForm} problem={problem} onProblem={setProblem} readOnly={!canEdit} api={api} layout="card" />
      {canEdit && dirty && (
        <div className="df-sf-actions">
          <button type="button" className="df-button" disabled={busy} onClick={cancel}>
            {words.card.cancel}
          </button>
          <button type="button" className="df-button df-button--primary" disabled={busy} onClick={() => void save()}>
            {busy ? words.saving : words.card.save}
          </button>
        </div>
      )}
    </section>
  )
}
