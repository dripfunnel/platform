import { useId, useState, type ReactNode } from 'react'
import { brandLimits, seoLimits, socialNetworks } from '../../api/storefront'
import { messages } from '../../messages'
import { pickerValue, type BrandForm, type FormProblem, type HomeForm } from './brandDraft'
import { ImageField } from '../common/ImageField'
import type { StorefrontApi } from './storefrontApi'
import { TextField } from './TextField'

const words = messages.storefront.brand
const imageWords = { upload: words.upload, replace: words.replace, uploading: words.uploading, remove: words.removeImage, required: words.required }

/** Every field these groups draw, so a refusal for any other is shown above them instead. */
export const brandFieldKeys = ['shopName', 'logo', 'favicon', 'primaryColour', 'secondaryColour', 'tagline', 'description', 'contactEmail', 'contactPhone', 'contactAddress', 'voice', ...socialNetworks.map((n) => `social.${n}`)]
export const homeFieldKeys = ['home.title', 'home.description']

export interface BrandFieldsProps {
  form: BrandForm
  onForm: (form: BrandForm) => void
  /** The home page's title and description: the brand step asks for them, Site settings keeps them in Search and sharing. */
  home?: { form: HomeForm; onForm: (form: HomeForm) => void }
  problem: FormProblem | null
  onProblem: (problem: FormProblem | null) => void
  readOnly: boolean
  api: StorefrontApi
  /** Each group in its own card (the brand step), or one card's sub-sections (Site settings › Brand). */
  layout: 'step' | 'card'
}

const Group = ({ layout, title, help, children }: { layout: BrandFieldsProps['layout']; title: string; help?: string; children: ReactNode }) => {
  const id = useId()
  const Heading = layout === 'step' ? 'h2' : 'h3'
  return (
    <section className={layout === 'step' ? 'df-sf-card df-sf-group' : 'df-sf-group'} aria-labelledby={id}>
      <Heading id={id}>{title}</Heading>
      {help && <p className="df-sf-lede">{help}</p>}
      <div className="df-sf-grid">{children}</div>
    </section>
  )
}

/** The brand's fields (FIRST-RELEASE §14 "Your brand"), shared by the brand step and Site settings › Brand. */
export const BrandFields = ({ form, onForm, home, problem, onProblem, readOnly, api, layout }: BrandFieldsProps) => {
  const id = useId()
  const [uploading, setUploading] = useState<'logo' | 'favicon' | null>(null)
  const at = (field: string) => (problem?.field === field ? problem.text : null)
  const set = (patch: Partial<BrandForm>) => onForm({ ...form, ...patch })

  const upload = (which: 'logo' | 'favicon', file: File) => {
    setUploading(which)
    onProblem(null)
    void api.uploadImage(file).then((r) => {
      setUploading(null)
      if (r.ok) set(which === 'logo' ? { logoAssetId: r.assetId } : { faviconAssetId: r.assetId })
      else onProblem({ field: which, text: words.uploadRefused[r.code] })
    })
  }

  const colour = (key: 'primaryColour' | 'secondaryColour', label: string, pick: string) => (
    <div className="df-sf-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <span className="df-sf-colour">
        <input type="color" aria-label={pick} data-empty={form[key] ? undefined : ''} value={pickerValue(form[key])} disabled={readOnly} onChange={(e) => set({ [key]: e.target.value })} />
        <input
          id={`${id}-${key}`}
          className="df-sf-mono"
          value={form[key] ?? ''}
          readOnly={readOnly}
          maxLength={7}
          placeholder="#"
          aria-invalid={at(key) ? true : undefined}
          aria-describedby={`${id}-${key}-below`}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      </span>
      <span id={`${id}-${key}-below`} className={at(key) ? 'df-sf-problem' : 'df-sf-help'} role={at(key) ? 'alert' : undefined}>
        {at(key) ?? words.colourHelp}
      </span>
    </div>
  )

  return (
    <>
      <Group layout={layout} title={words.sections.identity}>
        <TextField label={words.shopName} value={form.shopName} onValue={(shopName) => set({ shopName })} readOnly={readOnly} max={brandLimits.shopName} problem={at('shopName')} required autoComplete="organization" wide />
        <ImageField label={words.logo} help={words.logoHelp} alt={words.logoAlt} none={words.noLogo} assetId={form.logoAssetId} words={imageWords} required readOnly={readOnly} busy={uploading === 'logo'} problem={at('logo')} onFile={(f) => upload('logo', f)} />
      </Group>

      <Group layout={layout} title={words.sections.look} help={words.sections.lookHelp}>
        <ImageField label={words.favicon} help={words.faviconHelp} alt={words.faviconAlt} none={words.noFavicon} assetId={form.faviconAssetId} words={imageWords} readOnly={readOnly} busy={uploading === 'favicon'} problem={at('favicon')} onFile={(f) => upload('favicon', f)} onRemove={() => set({ faviconAssetId: null })} />
        <span className="df-sf-pair">
          {colour('primaryColour', words.primaryColour, words.pickPrimary)}
          {colour('secondaryColour', words.secondaryColour, words.pickSecondary)}
        </span>
      </Group>

      {home && (
        <Group layout={layout} title={words.sections.home} help={words.sections.homeHelp}>
          <TextField label={words.homeTitle} value={home.form.title} onValue={(title) => home.onForm({ ...home.form, title })} readOnly={readOnly} max={seoLimits.title} problem={at('home.title')} counted wide />
          <TextField label={words.homeDescription} value={home.form.description} onValue={(description) => home.onForm({ ...home.form, description })} readOnly={readOnly} max={seoLimits.description} problem={at('home.description')} counted multiline wide />
        </Group>
      )}

      <Group layout={layout} title={words.sections.about}>
        <TextField label={words.tagline} help={words.taglineHelp} value={form.tagline} onValue={(tagline) => set({ tagline })} readOnly={readOnly} max={brandLimits.tagline} problem={at('tagline')} counted wide />
        <TextField label={words.description} help={words.descriptionHelp} value={form.description} onValue={(description) => set({ description })} readOnly={readOnly} max={brandLimits.description} problem={at('description')} counted multiline wide />
        <div className="df-sf-field df-sf-field--wide" role="group" aria-labelledby={`${id}-voice`} aria-describedby={`${id}-voice-help`}>
          <span className="df-sf-label" id={`${id}-voice`}>
            {words.voice}
          </span>
          <span id={`${id}-voice-help`} className="df-sf-help">
            {words.voiceHelp}
          </span>
          <span className="df-sf-chips">
            {words.voices.map((v) => (
              <button key={v} type="button" aria-pressed={form.voice === v} disabled={readOnly} onClick={() => set({ voice: form.voice === v ? '' : v })}>
                {v}
              </button>
            ))}
          </span>
          <TextField label={words.voiceOwn} value={form.voice} onValue={(voice) => set({ voice })} readOnly={readOnly} max={brandLimits.voice} problem={at('voice')} />
        </div>
      </Group>

      <Group layout={layout} title={words.sections.social} help={words.sections.socialHelp}>
        {socialNetworks.map((n) => (
          <TextField
            key={n}
            label={words.social[n]}
            value={form.social[n]}
            onValue={(value) => set({ social: { ...form.social, [n]: value } })}
            readOnly={readOnly}
            max={brandLimits.social}
            problem={at(`social.${n}`)}
            placeholder={n === 'whatsapp' ? words.whatsappPlaceholder : words.socialPlaceholder}
            type={n === 'whatsapp' ? 'tel' : 'text'}
          />
        ))}
      </Group>

      <Group layout={layout} title={words.sections.contact} help={words.sections.contactHelp}>
        <TextField label={words.email} type="email" autoComplete="email" value={form.contactEmail} onValue={(contactEmail) => set({ contactEmail })} readOnly={readOnly} max={brandLimits.email} problem={at('contactEmail')} />
        <TextField label={words.phone} type="tel" autoComplete="tel" value={form.contactPhone} onValue={(contactPhone) => set({ contactPhone })} readOnly={readOnly} max={brandLimits.phone} problem={at('contactPhone')} />
        {(['street', 'city', 'postal', 'region'] as const).map((k) => (
          <TextField
            key={k}
            label={words[k]}
            value={form.contactAddress[k]}
            onValue={(value) => set({ contactAddress: { ...form.contactAddress, [k]: value } })}
            readOnly={readOnly}
            max={brandLimits[k]}
            problem={k === 'street' ? at('contactAddress') : null}
            wide={k === 'street'}
          />
        ))}
      </Group>
    </>
  )
}
