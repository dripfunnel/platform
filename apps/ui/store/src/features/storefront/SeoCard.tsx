import { useEffect, useId, useState } from 'react'
import { seoLimits, type StorefrontSeo } from '../../api/storefront'
import { fill, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { refusalIn } from '../common/refusal'
import type { StorefrontApi } from './storefrontApi'
import { counterText, googleDescription, googleTitle, seoTooLong } from './seoView'

const words = messages.storefront.seo

type SeoForm = { title: string; description: string; shareImageAssetId: string | null }
const formOf = (s: StorefrontSeo): SeoForm => ({ title: s.title ?? '', description: s.description ?? '', shareImageAssetId: s.shareImageAssetId })

export interface SeoCardProps {
  seo: StorefrontSeo
  shopName: string
  /** The address shoppers reach the shop at, which both previews show. */
  host: string
  canEdit: boolean
  api: StorefrontApi
  onSaved: (seo: StorefrontSeo, toast: string) => void
}

/** Site settings › Search and sharing (PortalStorefront): the home page's title, description and share image, with both previews. */
export const SeoCard = ({ seo, shopName, host, canEdit, api, onSaved }: SeoCardProps) => {
  const id = useId()
  const [saved, setSaved] = useState(() => formOf(seo))
  const [form, setForm] = useState(saved)
  const [photos, setPhotos] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const tooLong = seoTooLong(form)

  // A hint beside the form: without it the picker says there are no photos, and the rest still works.
  useEffect(() => {
    let live = true
    void api.loadShareImages().then(
      (ids) => live && setPhotos(ids),
      () => live && setPhotos([]),
    )
    return () => {
      live = false
    }
  }, [api])
  const choices = saved.shareImageAssetId && !photos.includes(saved.shareImageAssetId) ? [saved.shareImageAssetId, ...photos] : photos

  const save = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const answer = await api.saveSeo(form)
      const next = formOf(answer)
      setSaved(next)
      setForm(next)
      onSaved(answer, words.saved)
    } catch (error) {
      setProblem(refusalIn(words.refused)(error))
    } finally {
      setBusy(false)
    }
  }

  const counter = (key: 'title' | 'description') => (
    <span className={form[key].length > seoLimits[key] ? 'df-sf-count df-sf-count--over' : 'df-sf-count'} id={`${id}-${key}-count`}>
      {counterText(form[key].length, seoLimits[key])}
    </span>
  )

  return (
    <section className="df-sf-card df-sf-seo" aria-labelledby={`${id}-title`}>
      <div className="df-sf-card-head">
        <h2 id={`${id}-title`}>{words.title}</h2>
        <p className="df-sf-lede">{words.lede}</p>
      </div>
      {problem && (
        <p className="df-sf-failure" role="alert">
          {problem}
        </p>
      )}
      <div className="df-sf-field">
        <span className="df-sf-field-head">
          <label htmlFor={`${id}-page-title`}>{words.pageTitle}</label>
          {counter('title')}
        </span>
        <input id={`${id}-page-title`} value={form.title} readOnly={!canEdit} aria-describedby={`${id}-title-count`} aria-invalid={form.title.length > seoLimits.title || undefined} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div className="df-sf-field">
        <span className="df-sf-field-head">
          <label htmlFor={`${id}-description`}>{words.description}</label>
          {counter('description')}
        </span>
        <textarea id={`${id}-description`} rows={3} value={form.description} readOnly={!canEdit} aria-describedby={`${id}-description-count`} aria-invalid={form.description.length > seoLimits.description || undefined} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="df-sf-field" role="group" aria-labelledby={`${id}-share`}>
        <span className="df-sf-label" id={`${id}-share`}>
          {words.shareImage}
        </span>
        {choices.length > 0 ? (
          <span className="df-sf-photos">
            {choices.map((asset, i) => (
              <button key={asset} type="button" aria-pressed={form.shareImageAssetId === asset} aria-label={fill(words.usePhoto, { number: String(i + 1) })} disabled={!canEdit} onClick={() => setForm({ ...form, shareImageAssetId: asset })}>
                <AssetImage url={`/api/assets/${asset}`} alt="" className="df-sf-photo" placeholder="" />
              </button>
            ))}
          </span>
        ) : (
          <span className="df-sf-help">{words.noPhotos}</span>
        )}
        {choices.length > 0 && <span className="df-sf-help">{words.shareHelp}</span>}
      </div>
      <div className="df-sf-previews">
        <div className="df-sf-preview">
          <span className="df-sf-kicker">{words.google}</span>
          <span className="df-sf-google-host">{host}</span>
          <span className="df-sf-google-title">{googleTitle(form.title, shopName)}</span>
          <span className="df-sf-google-text">{googleDescription(form.description)}</span>
        </div>
        <div className="df-sf-preview df-sf-preview--share">
          <span className="df-sf-kicker">{words.shared}</span>
          {form.shareImageAssetId ? <AssetImage url={`/api/assets/${form.shareImageAssetId}`} alt="" className="df-sf-share-image" placeholder="" /> : <span className="df-sf-share-image df-sf-share-image--none" />}
          <span className="df-sf-share-foot">
            <span className="df-sf-share-host">{host}</span>
            <span className="df-sf-share-title">{googleTitle(form.title, shopName)}</span>
          </span>
        </div>
      </div>
      {canEdit && dirty && (
        <div className="df-sf-actions">
          {tooLong && <span className="df-sf-problem">{words.tooLong}</span>}
          <button
            type="button"
            className="df-button"
            disabled={busy}
            onClick={() => {
              setForm(saved)
              setProblem(null)
            }}
          >
            {words.cancel}
          </button>
          <button type="button" className="df-button df-button--primary" disabled={busy || tooLong} onClick={() => void save()}>
            {busy ? words.saving : words.save}
          </button>
        </div>
      )}
    </section>
  )
}
