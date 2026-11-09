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
[part~=item]:not(:last-child)::after{content:'/' / '';margin-left:8px;${muted}}
[part~=current]{${muted}}`,
  summary: `:host{display:block!important}
[part~=lines]{list-style:none;padding:0;display:grid;gap:12px;margin-bottom:16px!important}
[part~=line]{display:grid!important;grid-template-columns:auto 1fr auto;gap:12px;align-items:start}
[part~=photo]{width:56px;height:70px;object-fit:cover;border-radius:var(--df-sealed-radius,8px)}
[part~=name]{font-weight:600;display:block}
[part~=version]{${muted};display:block}
[part~=note]{${muted}}
[part~=rows]{display:grid!important;gap:8px}
[part~=row],[part~=total]{display:flex!important;justify-content:space-between;gap:16px}
[part~=total]{font-weight:700;font-size:max(14px,1.15em)!important}
[part~=saving]{color:var(--df-sealed-saving,inherit)}`,
  payment: `:host{display:block!important}
[part~=panel]{display:grid!important;gap:12px}
[part~=test]{padding:10px 12px;border-radius:var(--df-sealed-radius,8px);background:var(--df-preview-surface,#fdf3dc);color:var(--df-preview-color,#5c3d00)}
[part~=field]:empty{display:none}
[part~=status]{${muted}}
${button}`,
  // The customisation modal (§3.5): a <dialog> in the top layer, full width at the bottom on a phone, centred from 640px.
  customise: `:host{display:contents!important}
dialog[part~=dialog]{position:fixed!important;inset:auto 0 0 0!important;margin:0!important;width:100%!important;max-width:none!important;max-height:92vh!important;min-width:320px!important;box-sizing:border-box;padding:0;border:0;border-radius:var(--df-sealed-radius,16px) var(--df-sealed-radius,16px) 0 0;background:var(--df-sealed-surface,#fff);color:var(--df-sealed-color,#111);overflow:auto!important}
dialog[part~=dialog]::backdrop{background:var(--df-sealed-backdrop,rgba(0,0,0,.45))}
@media (min-width:640px){dialog[part~=dialog]{inset:0!important;margin:auto!important;width:min(560px,calc(100% - 32px))!important;border-radius:var(--df-sealed-radius,16px)}}
[part~=form]{display:grid!important;gap:16px;padding:20px}
[part~=title]{font-size:max(17px,1.2em)!important;font-weight:700}
[part~=question]{display:grid!important;gap:8px;border:0;padding:0;min-width:0}
[part~=label]{font-weight:600}
[part~=hint],[part~=rule]{${muted};font-size:max(12px,.875em)!important}
[part~=choice]{display:flex!important;align-items:center;gap:10px;min-height:44px}
[part~=choice][aria-disabled=true]{${muted}}
[part~=photo]{width:40px;height:40px;object-fit:cover;border-radius:var(--df-sealed-radius,8px)}
[part~=extra]{${muted};margin-left:auto}
input[type=text],textarea{font:inherit;min-height:44px;padding:8px 10px;border:1px solid currentColor;border-radius:var(--df-sealed-radius,8px);background:transparent;color:inherit;width:100%;box-sizing:border-box}
input[type=number]{font:inherit;width:72px;min-height:44px;padding:0 8px;border:1px solid currentColor;border-radius:var(--df-sealed-radius,8px);background:transparent;color:inherit}
[part~=error],[part~=problem]{color:var(--df-sealed-error,#b42318)}
[part~=total]{display:flex!important;justify-content:space-between;gap:16px;font-weight:700;font-size:max(15px,1.1em)!important}
[part~=actions]{display:flex!important;flex-wrap:wrap;justify-content:flex-end;gap:8px}
[part~=files]{display:grid!important;gap:6px;list-style:none;padding:0}
[part~=primary]{background:var(--df-sealed-accent,currentColor);color:var(--df-sealed-on-accent,#fff);border-color:var(--df-sealed-accent,currentColor)}
:focus-visible,label[part~=button]:has(input:focus-visible){outline:2px solid var(--df-sealed-focus,currentColor)!important;outline-offset:2px!important}
${button}`,
}

export const sealedCss = (part: SealedPart): string => locked + parts[part]
