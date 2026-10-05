import { Icon, initials, type IconName } from '@dripfunnel/shared/ui'
import type { ReactNode } from 'react'
import logoInverse from '../../assets/dripfunnel-logo-inverse.svg'
import logo from '../../assets/dripfunnel-logo.svg'
import { currentBrand } from '../../brand/current'
import { messages } from '../../messages'
import { EnvironmentStrip } from '../shell/EnvironmentStrip'
import './auth.css'

const words = messages.auth

export type Panel = keyof typeof words.panels

const Legal = () => (
  <>
    <a href={words.privacyUrl} target="_blank" rel="noopener noreferrer">
      {words.privacy}
      <span className="df-visually-hidden"> {words.opensInNewTab}</span>
    </a>
    {' · '}
    <a href={currentBrand()?.helpUrl ?? words.helpUrl} target="_blank" rel="noopener noreferrer">
      {words.help}
      <span className="df-visually-hidden"> {words.opensInNewTab}</span>
    </a>
  </>
)

export interface AuthFrameProps {
  panel: Panel
  title: string
  sub?: ReactNode
  back?: { label: string; onBack: () => void } | undefined
  /** The sign-up's four steps (0–3), or `building` for the last bar. */
  step?: number | 'building' | undefined
  /** An icon, or a store's initial (an invitation shows the store it is for). */
  icon?: ({ name: IconName } | { letter: string }) & { tone: 'info' | 'warning' } | undefined
  notice?: { text: string; tone: 'info' | 'error' } | null | undefined
  children?: ReactNode
}

// PortalAuth's frame (designs/PortalAuth.dc.html): the brand panel on the left, in the partner's look
// on its host (its mark and name, never DripFunnel's; store README §2), the form on the right; on a phone, the form alone.
export const AuthFrame = ({ panel, title, sub, back, step, icon, notice, children }: AuthFrameProps) => {
  const brand = currentBrand()
  const copy = words.panels[panel]
  return (
    <div className="df-portal-auth">
      <div className="df-banners">
        <EnvironmentStrip />
      </div>
      <div className="df-portal-auth-grid">
        <aside className="df-portal-auth-panel">
          <span className="df-portal-auth-ring" aria-hidden="true" />
          {brand ? (
            <span className="df-portal-auth-mark">
              <span className="df-portal-auth-mark-tile">{initials(brand.productName).slice(0, 1)}</span>
              <span className="df-portal-auth-mark-name">{brand.productName}</span>
            </span>
          ) : (
            <span className="df-portal-auth-mark">
              <img src={logoInverse} alt="" height={32} />
              <span className="df-portal-auth-product">{words.productLabel}</span>
            </span>
          )}
          <div className="df-portal-auth-pitch">
            <span className="df-portal-auth-tag">{copy.tag}</span>
            <span className="df-portal-auth-title">{copy.title}</span>
            <span className="df-portal-auth-body">{copy.body}</span>
            <ul>
              {copy.points.map((point) => (
                <li key={point}>
                  <span className="df-portal-auth-tick" aria-hidden="true">
                    <Icon name="check" size={12} strokeWidth={2.4} />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <span className="df-portal-auth-foot">
            {brand ? (brand.supportEmail ?? brand.supportUrl ?? brand.productName) : words.footBrand} · <Legal />
          </span>
        </aside>
        <main className="df-portal-auth-main">
          <div className="df-portal-auth-form">
            <span className="df-portal-auth-phone-logo">
              {brand ? (
                <span className="df-portal-auth-mark df-portal-auth-mark--light">
                  <span className="df-portal-auth-mark-tile">{initials(brand.productName).slice(0, 1)}</span>
                  <span className="df-portal-auth-mark-name">{brand.productName}</span>
                </span>
              ) : (
                <>
                  <img src={logo} alt={words.logoAlt} height={28} />
                  <span className="df-portal-auth-product">{words.productLabel}</span>
                </>
              )}
            </span>
            {back && (
              <button type="button" className="df-portal-auth-back" onClick={back.onBack}>
                <Icon name="back" size={14} />
                {back.label}
              </button>
            )}
            {step !== undefined && (
              <div className="df-portal-auth-stepper">
                <div className="df-portal-auth-dots" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={step === 'building' || i <= step ? 'df-on' : undefined} />
                  ))}
                </div>
                <span>{step === 'building' ? words.signup.building.label : words.signup.steps[step]}</span>
              </div>
            )}
            {icon && (
              <span className={`df-portal-auth-icon df-portal-auth-icon--${icon.tone}`} aria-hidden="true">
                {'name' in icon ? <Icon name={icon.name} size={22} /> : icon.letter}
              </span>
            )}
            <div className="df-portal-auth-heading">
              <h1 tabIndex={-1}>{title}</h1>
              {sub && <p>{sub}</p>}
            </div>
            {notice && (
              <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`df-portal-auth-notice df-portal-auth-notice--${notice.tone}`}>
                {notice.text}
              </p>
            )}
            {children}
          </div>
        </main>
      </div>
      <footer className="df-portal-auth-legal">
        <Legal />
      </footer>
    </div>
  )
}
