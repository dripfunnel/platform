import { useId, useState } from 'react'
import type { StorefrontBrand, StorefrontSeo } from '../../api/storefront'
import { messages } from '../../messages'
import { BrandFields, brandFieldKeys, homeFieldKeys } from './BrandFields'
import { brandComplete, brandFormOf, brandInputOf, brandProblemOf, homeFormOf, type FormProblem } from './brandDraft'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.brand

export interface BrandStepProps {
  brand: StorefrontBrand | null
  seo: StorefrontSeo
  api: StorefrontApi
  onDone: (brand: StorefrontBrand, seo: StorefrontSeo) => void
}

/** "Your brand" (FIRST-RELEASE §14, not drawn): the Owner's first visit, before the template gallery. */
export const BrandStep = ({ brand, seo, api, onDone }: BrandStepProps) => {
  const id = useId()
  const [form, setForm] = useState(() => brandFormOf(brand))
  const [home, setHome] = useState(() => homeFormOf(seo))
  const [problem, setProblem] = useState<FormProblem | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = brandComplete(form)

  const save = async () => {
    if (!brandComplete(form)) return
    setBusy(true)
    setProblem(null)
    let savedSeo = seo
    try {
      // The home page's words first: a brand saved alone would end the step and leave them unsaved.
      if (home.title !== (seo.title ?? '') || home.description !== (seo.description ?? '')) {
        try {
          savedSeo = await api.saveSeo({ ...home, shareImageAssetId: seo.shareImageAssetId })
        } catch (error) {
          const p = brandProblemOf(error, words.refused)
          setProblem({ ...p, field: p.field ? `home.${p.field}` : null })
          return
        }
      }
      onDone(await api.saveBrand(brandInputOf(form)), savedSeo)
    } catch (error) {
      setProblem(brandProblemOf(error, words.refused))
    } finally {
      setBusy(false)
    }
  }

  const above = problem && !(problem.field && [...brandFieldKeys, ...homeFieldKeys].includes(problem.field))
  return (
    <form
      className="df-sf-step"
      aria-labelledby={`${id}-title`}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="df-sf-step-head">
        <h1 id={`${id}-title`} className="df-sf-title">
          {words.title}
        </h1>
        <p className="df-sf-sub">{words.lede}</p>
      </div>
      {above && (
        <p className="df-sf-failure" role="alert">
          {problem.text}
        </p>
      )}
      <BrandFields form={form} onForm={setForm} home={{ form: home, onForm: setHome }} problem={problem} onProblem={setProblem} readOnly={false} api={api} layout="step" />
      <div className="df-sf-step-foot">
        {!ready && <span className="df-sf-help" id={`${id}-needed`}>{words.needed}</span>}
        <button type="submit" className="df-button df-button--primary" disabled={!ready || busy} aria-describedby={ready ? undefined : `${id}-needed`}>
          {busy ? words.saving : words.continue}
        </button>
      </div>
    </form>
  )
}
