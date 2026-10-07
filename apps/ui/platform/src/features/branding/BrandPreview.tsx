import '@fontsource-variable/dm-sans'
import '@fontsource-variable/lora'
import '@fontsource-variable/nunito'
import '@fontsource-variable/source-sans-3'
import { initials } from '@dripfunnel/shared/ui'
import type { CSSProperties } from 'react'
import type { Money } from '@dripfunnel/shared/format'
import { formatAmount, formatCount, messages } from '../../messages'
import type { BrandDraft } from './brandDraft'

const words = messages.branding.preview

export type PreviewScreen = 'signin' | 'header'
export type PreviewDevice = 'desktop' | 'phone'
export type PreviewMode = 'light' | 'dark'

export interface BrandPreviewProps {
  draft: BrandDraft
  screen: PreviewScreen
  device: PreviewDevice
  mode: PreviewMode
  onScreen: (screen: PreviewScreen) => void
  onDevice: (device: PreviewDevice) => void
  onMode: (mode: PreviewMode) => void
}

const radius: Record<BrandDraft['look']['corner'], string> = { rounded: '12px', soft: '6px', square: '0' }

// The preview's own variables, `--pv-*`: the partner's look reaches only this frame, never the console's
// `--df-*` tokens (ui/platform/README.md §4).
const variablesOf = (draft: BrandDraft, mode: PreviewMode): CSSProperties => {
  const dark = mode === 'dark'
  const { primary, accent, font, corner, background } = draft.look
  return {
    '--pv-primary': primary,
    '--pv-accent': accent,
    '--pv-font': `"${font}", system-ui, sans-serif`,
    '--pv-radius': radius[corner],
    '--pv-bg': dark ? '#111418' : '#FFFFFF',
    '--pv-fg': dark ? '#E9EDF1' : '#14181F',
    '--pv-muted': dark ? '#9AA5B1' : '#5A6472',
    '--pv-line': dark ? '#262C33' : '#E6E1DB',
    '--pv-side': dark ? '#171B21' : '#F8F6F3',
    '--pv-page': background === 'plain' ? primary : background === 'sand' ? `repeating-linear-gradient(135deg, ${accent} 0 2px, transparent 2px 12px), ${dark ? '#1C2026' : '#F6EFE6'}` : 'linear-gradient(160deg, #35607A, #9EC3C9)',
  } as CSSProperties
}

// The sample portal's numbers, formatted like the real portal's.
const sampleSales: Money = { amount: 124000, currency: 'USD' }
const sampleOrders = 7

const Toggle = <Value extends string>({ label, options, value, onPick }: { label: string; options: Readonly<Record<Value, string>>; value: Value; onPick: (value: Value) => void }) => (
  <div role="group" aria-label={label} className="df-pv-toggle">
    {(Object.keys(options) as Value[]).map((option) => (
      <button key={option} type="button" aria-pressed={option === value} onClick={() => onPick(option)}>
        {options[option]}
      </button>
    ))}
  </div>
)

const fileUrl = (key: string): string => `/api/uploads/brand-file?key=${encodeURIComponent(key)}`

// The portal's rule (ui/store/README.md §4): the logo for the background it sits on, else the mark, else a plain tile.
const Brand = ({ draft, logo }: { draft: BrandDraft; logo: 'logoLight' | 'logoDark' }) => {
  const { files, productName } = draft.look
  if (files[logo]) return <img className="pv-logo" src={fileUrl(files[logo])} alt={productName} />
  return (
    <>
      <span className="pv-mark" aria-hidden="true">
        {files.mark && <img src={fileUrl(files.mark)} alt="" />}
      </span>
      <strong>{productName}</strong>
    </>
  )
}

const SignInCard = ({ draft, mode }: { draft: BrandDraft; mode: PreviewMode }) => (
  <div className="pv-page">
    <div className="pv-card">
      <div className="pv-brand">
        <Brand draft={draft} logo={mode === 'dark' ? 'logoDark' : 'logoLight'} />
      </div>
      <strong className="pv-title">{words.signInTitle}</strong>
      <span className="pv-field">{words.email}</span>
      <span className="pv-field">{words.password}</span>
      <span className="pv-button">{words.signIn}</span>
      <span className="pv-link">{words.forgot}</span>
      {draft.words.poweredBy && <span className="pv-powered">{words.poweredBy}</span>}
    </div>
  </div>
)

const Header = ({ draft, device }: { draft: BrandDraft; device: PreviewDevice }) => (
  <div className="pv-app">
    <div className="pv-header">
      <Brand draft={draft} logo="logoDark" />
      {device === 'desktop' && <span className="pv-search">{words.search}</span>}
      <span className="pv-help">{words.help}</span>
      <span className="pv-avatar" aria-hidden="true">
        {initials(words.owner)}
      </span>
    </div>
    <div className="pv-body">
      {device === 'desktop' && (
        <nav className="pv-nav" aria-hidden="true">
          {Object.values(words.nav).map((item, index) => (
            <span key={item} className={index === 0 ? 'pv-nav-item pv-nav-item--active' : 'pv-nav-item'}>
              {item}
            </span>
          ))}
        </nav>
      )}
      <div className="pv-main">
        <span className="pv-muted">{words.store}</span>
        <strong className="pv-title">{words.welcome}</strong>
        <div className="pv-tiles">
          <span className="pv-tile">
            <span className="pv-muted">{words.sales}</span>
            <strong>{formatAmount(sampleSales)}</strong>
          </span>
          <span className="pv-tile">
            <span className="pv-muted">{words.orders}</span>
            <strong>{formatCount(sampleOrders)}</strong>
          </span>
        </div>
        {draft.words.poweredBy && <span className="pv-powered">{words.poweredBy}</span>}
      </div>
    </div>
  </div>
)

// Sample portal screens in the partner's look (§8.1), framed and labelled as a preview; the real screens
// arrive when apps/ui/store has them.
export const BrandPreview = ({ draft, screen, device, mode, onScreen, onDevice, onMode }: BrandPreviewProps) => (
  <section className="df-brand-preview" aria-label={words.label}>
    <div className="df-pv-controls">
      <span className="df-eyebrow">{words.label}</span>
      <Toggle label={words.screenLabel} options={words.screens} value={screen} onPick={onScreen} />
      <Toggle label={words.deviceLabel} options={words.devices} value={device} onPick={onDevice} />
      <Toggle label={words.modeLabel} options={words.modes} value={mode} onPick={onMode} />
    </div>
    <div className="df-pv-frame">
      <div className={device === 'phone' ? 'pv-root pv-root--phone' : 'pv-root'} style={variablesOf(draft, mode)}>
        {screen === 'signin' ? <SignInCard draft={draft} mode={mode} /> : <Header draft={draft} device={device} />}
      </div>
    </div>
    <p className="df-muted df-pv-note">{words.frame}</p>
  </section>
)
