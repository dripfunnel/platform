import { button, muted } from './styles'

// The customisation modal (ARCHITECTURE §3.5): a <dialog> in the top layer, full width at the bottom on a phone, centred from 640px;
// its custom properties are the shared ones plus accent, on-accent, error, focus and backdrop. Only its lazy chunk carries it.
export const customiseCss = `dialog[part~=dialog]{position:fixed!important;inset:auto 0 0 0!important;margin:0!important;width:100%!important;max-width:none!important;max-height:92vh!important;min-width:320px!important;box-sizing:border-box;padding:0;border:0;border-radius:var(--df-sealed-radius,16px) var(--df-sealed-radius,16px) 0 0;background:var(--df-sealed-surface,#fff);color:var(--df-sealed-color,#111);overflow:auto!important}
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
${button}`
