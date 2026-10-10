import type { SealedPart } from './element'

// Inside a shadow root an !important declaration beats the page's, even its own !important (CSS
// Scoping §3.3), so what keeps a part seen is locked here; the theme styles the rest (ARCHITECTURE §3.5).
const locked = `
:host{visibility:visible!important;opacity:1!important;content-visibility:visible!important;filter:none!important;clip-path:none!important;mask:none!important;overflow:visible!important;pointer-events:auto!important;font-family:var(--df-sealed-font,inherit);color:var(--df-sealed-color,inherit)}
[part]{visibility:visible!important;opacity:1!important;content-visibility:visible!important;filter:none!important;clip-path:none!important;mask:none!important;transform:none!important;position:static!important;margin:0!important;text-indent:0!important;overflow:visible!important;pointer-events:auto!important;font-size:max(12px,var(--df-sealed-size,1em))!important}
slot{display:contents}
`

const muted = 'color:var(--df-sealed-muted,currentColor)'
const button = `[part~=button]{min-height:44px;min-width:44px;padding:0 16px;font:inherit;font-size:max(14px,var(--df-sealed-size,1em))!important;border:1px solid currentColor;border-radius:var(--df-sealed-radius,8px);background:transparent;color:inherit;cursor:pointer}`
const banner = (edge: 'top' | 'bottom') =>
  `[popover]{position:fixed!important;${edge === 'top' ? 'inset:0 0 auto 0!important' : 'inset:auto 0 12px 0!important'};display:block!important;margin:0 auto!important;max-height:none!important;overflow:visible!important;box-sizing:border-box;border:0}`

const parts: Record<SealedPart, string> = {
  price: `:host{display:inline-block!important}
.price{display:inline-flex!important;flex-wrap:wrap;align-items:baseline;gap:4px 8px}
[part~=amount]{font-weight:700;font-size:max(12px,var(--df-price-size,1em))!important}
[part~=was]{${muted};text-decoration:line-through!important;font-size:max(12px,0.9em)!important}
[part~=tax]{${muted};font-size:max(12px,0.75em)!important}`,
  preview: `:host{display:block!important}
${banner('top')}
[popover]{width:100%!important;max-width:none!important;padding:8px 16px;text-align:center;background:var(--df-preview-surface,#1f2937);color:var(--df-preview-color,#fff);font-size:max(13px,var(--df-sealed-size,13px))!important}`,
  powered: `:host{display:inline-block!important}
[part~=line]{${muted};font-size:max(12px,var(--df-sealed-size,13px))!important}`,
  legal: `:host{display:block!important}
[part~=title]{font-weight:600;font-size:max(13px,1em)!important}
[part~=body]{${muted};font-size:max(12px,0.875em)!important}`,
  consent: `:host{display:block!important}
${banner('bottom')}
[popover]{width:calc(100% - 24px)!important;max-width:760px!important;padding:18px;display:flex!important;flex-direction:column;gap:12px;background:var(--df-sealed-surface,#fff);color:var(--df-sealed-color,#111);border-radius:var(--df-sealed-radius,12px);box-shadow:0 20px 50px -20px rgba(0,0,0,.35)}
[part~=title]{font-size:max(16px,1.125em)!important;font-weight:700}
.actions{display:grid;gap:8px}
@media (min-width:640px){.actions{grid-template-columns:repeat(3,auto);justify-content:end}}
label{display:flex!important;gap:8px;align-items:center;min-height:44px}
${button}`,
  'consent-settings': `:host{display:inline-block!important}
${button}`,
  breadcrumbs: `:host{display:block!important}
[part~=list]{display:flex!important;flex-wrap:wrap;gap:4px 8px;list-style:none;padding:0}
[part~=link]{color:inherit}
[part~=current]{${muted}}`,
}

export const sealedCss = (part: SealedPart): string => locked + parts[part]
