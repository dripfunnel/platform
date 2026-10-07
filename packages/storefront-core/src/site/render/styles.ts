import { fontStack } from '../fonts'
import type { SiteTheme } from '../schema'

const rgba = (hex: string, alpha: number): string => {
  let h = hex.slice(1)
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = Number.parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

const tones = { soft: 'none', vivid: 'saturate(1.15)', dark: 'brightness(0.82)', mono: 'grayscale(1)' } as const

/** The theme as custom properties on the site's root element. */
export const themeVars = (t: SiteTheme): Record<`--${string}`, string> => ({
  '--dfs-bg': t.bg,
  '--dfs-surface': t.surface,
  '--dfs-text': t.text,
  '--dfs-muted': t.muted,
  '--dfs-accent': t.accent,
  '--dfs-accent-text': t.accentText,
  '--dfs-line': rgba(t.text, 0.12),
  '--dfs-line-strong': rgba(t.text, 0.28),
  '--dfs-head': fontStack(t.headFont),
  '--dfs-body': fontStack(t.bodyFont),
  '--dfs-head-weight': String(t.headWeight),
  '--dfs-head-case': t.headCase,
  '--dfs-head-spacing': t.headCase === 'uppercase' ? '0.01em' : '-0.02em',
  '--dfs-radius': `${t.radius}px`,
  '--dfs-radius-img': `${Math.max(0, t.radius - 4)}px`,
  '--dfs-img-filter': tones[t.imgTone],
})

// Sizes per width as designs/SitePreview draws them: phone below 640 px, tablet to 1079,
// desktop from 1080. Container queries, so a studio frame and a full page agree.
export const siteCss = `
.dfs{container:dfs/inline-size}
.dfs-in{background:var(--dfs-bg);color:var(--dfs-text);font-family:var(--dfs-body);line-height:1.55;text-wrap:pretty;
--px:56px;--py:80px;--py-sm:44px;--h1:60px;--h1-big:84px;--h2:34px;--lead:18px;--fs:16px;--gap:56px;--grid-gap:20px;--quote:34px;--full-h:640px;--cols-max:5;font-size:var(--fs)}
.dfs *{box-sizing:border-box}
.dfs a{color:inherit}
.dfs-menu{position:relative;font-size:14px}
.dfs-menu summary{cursor:pointer;list-style:none}
.dfs-menu ul{position:absolute;right:0;top:32px;z-index:5;min-width:180px;margin:0;padding:12px 16px;list-style:none;display:flex;flex-direction:column;gap:10px;background:var(--dfs-bg);border:1px solid var(--dfs-line);border-radius:var(--dfs-radius)}
.dfs-menu a{text-decoration:none}
.dfs-h{margin:0;font-family:var(--dfs-head);font-weight:var(--dfs-head-weight);text-transform:var(--dfs-head-case);letter-spacing:var(--dfs-head-spacing);line-height:1.05;text-wrap:balance}
.dfs-h1{font-size:var(--h1)}.dfs-h2{font-size:var(--h2);line-height:1.1}
.dfs-lead{margin:0;color:var(--dfs-muted);font-size:var(--lead)}
.dfs .dfs-btn{display:inline-block;padding:14px 26px;border-radius:var(--dfs-radius);background:var(--dfs-accent);color:var(--dfs-accent-text);font-weight:600;font-size:15px;text-decoration:none}
.dfs-img{display:block;width:100%;height:100%;object-fit:cover;filter:var(--dfs-img-filter);border-radius:var(--dfs-radius-img)}
.dfs-ph{background:var(--dfs-surface);border-radius:var(--dfs-radius)}
.dfs-sec{padding:var(--py) var(--px)}
.dfs-ann{margin:0;padding:9px 16px;text-align:center;font-size:13px}
.dfs-hdr{border-bottom:1px solid var(--dfs-line)}
.dfs-hdr-row{height:64px;padding:0 var(--px);display:flex;align-items:center;gap:28px}
.dfs-hdr-center{padding:18px var(--px) 12px;display:flex;flex-direction:column;align-items:center;gap:12px}
.dfs-brand{font-family:var(--dfs-head);font-weight:var(--dfs-head-weight);text-transform:var(--dfs-head-case);letter-spacing:var(--dfs-head-spacing);font-size:20px;text-decoration:none;white-space:nowrap}
.dfs-hdr-center .dfs-brand{font-size:24px}
.dfs-nav{display:flex;gap:24px;font-size:14px;margin:0;padding:0;list-style:none}
.dfs-nav a{text-decoration:none;white-space:nowrap}
.dfs-nav a[aria-current=page]{font-weight:700}
.dfs-spacer{flex:1}
.dfs-cart{font-size:14px;text-decoration:none;white-space:nowrap}
.dfs-split{display:grid;grid-template-columns:1.05fr 1fr;gap:var(--gap);align-items:center}
.dfs-stack{display:flex;flex-direction:column;gap:18px;align-items:flex-start}
.dfs-hero-img{aspect-ratio:4/5;overflow:hidden;border-radius:var(--dfs-radius)}
.dfs-full{min-height:var(--full-h);display:flex;align-items:flex-end;position:relative;overflow:hidden;background:var(--dfs-text)}
.dfs-full>.dfs-img{position:absolute;inset:0;border-radius:0}
.dfs-full::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.62),rgba(0,0,0,.05) 70%)}
.dfs-full .dfs-stack{position:relative;z-index:1;color:#FFFFFF;max-width:760px}
.dfs-full .dfs-h1{font-size:var(--h1-big);line-height:1}
.dfs-center{display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center}
.dfs-center .dfs-h1{max-width:18ch}
.dfs-wide{width:100%;aspect-ratio:21/9;margin-top:16px;overflow:hidden;border-radius:var(--dfs-radius)}
.dfs-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.dfs-grid{display:grid;grid-template-columns:repeat(min(var(--cols),var(--cols-max)),minmax(0,1fr));gap:var(--grid-gap);margin:0;padding:0;list-style:none}
.dfs-card{display:flex;flex-direction:column;gap:10px;text-decoration:none;min-width:0;border-radius:var(--dfs-radius)}
.dfs-card.boxed{background:var(--dfs-surface);padding:10px 10px 14px}
.dfs-card-img{overflow:hidden;border-radius:var(--dfs-radius-img);background:var(--dfs-surface)}
.dfs-card-name{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dfs-card-price{font-size:14px;color:var(--dfs-muted)}
.dfs-tile{position:relative;display:flex;align-items:flex-end;aspect-ratio:1;padding:14px;overflow:hidden;border-radius:var(--dfs-radius);background:var(--dfs-surface);text-decoration:none}
.dfs-tile>.dfs-img{position:absolute;inset:0;border-radius:0}
.dfs-tile span{position:relative;background:var(--dfs-bg);color:var(--dfs-text);padding:6px 12px;border-radius:var(--dfs-radius);font-size:14px;font-weight:600}
.dfs-banner{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
.dfs-banner p{margin:0;font-size:var(--lead);max-width:50ch}
.dfs-feat{padding:var(--py-sm) var(--px);border-top:1px solid var(--dfs-line);border-bottom:1px solid var(--dfs-line);display:flex;flex-direction:column;gap:24px}
.dfs-feat-title{font-family:var(--dfs-head);font-weight:var(--dfs-head-weight);font-size:18px}
.dfs-quote{background:var(--dfs-surface);display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;margin:0}
.dfs-quote blockquote{margin:0;font-family:var(--dfs-head);font-weight:var(--dfs-head-weight);font-size:var(--quote);line-height:1.3;max-width:28ch;text-wrap:balance}
.dfs-quote figcaption{font-size:14px;color:var(--dfs-muted)}
.dfs-form{display:flex;gap:8px;width:100%;max-width:440px;flex-wrap:wrap}
.dfs-input{flex:1;min-width:180px;height:46px;border:1px solid var(--dfs-line-strong);border-radius:var(--dfs-radius);padding:0 14px;font:inherit;font-size:14px;background:var(--dfs-surface);color:var(--dfs-text)}
.dfs-form .dfs-btn{border:0;height:46px;padding:0 22px;cursor:pointer;font:inherit;font-weight:600}
.dfs-text{display:flex;flex-direction:column;gap:14px}
.dfs-text.center{align-items:center;text-align:center}
.dfs-text .dfs-h2{max-width:22ch;line-height:1.15}
.dfs-text p{max-width:56ch;white-space:pre-line}
.dfs-ftr{padding:var(--py-sm) var(--px);display:flex;flex-direction:column;gap:18px}
.dfs-ftr-row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
.dfs-ftr-brand{font-family:var(--dfs-head);font-weight:var(--dfs-head-weight);text-transform:var(--dfs-head-case);font-size:18px}
.dfs-ftr-text{font-size:14px;opacity:.8;margin:0}
.dfs-ftr ul{display:flex;gap:20px;flex-wrap:wrap;font-size:14px;margin:0;padding:0;list-style:none}
.dfs-ftr a{text-decoration:none}
.dfs-copy{font-size:12px;opacity:.7;margin:0}
.dfs-about-img{aspect-ratio:4/5;overflow:hidden;border-radius:var(--dfs-radius);align-self:start}
.dfs-contact dl{display:flex;flex-direction:column;gap:14px;font-size:15px;margin:0}
.dfs-contact dt{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dfs-muted)}
.dfs-contact dd{margin:0}
.dfs-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@container dfs (max-width:1079px){.dfs-in{--cols-max:3;--px:32px;--py:56px;--py-sm:36px;--h1:44px;--h1-big:56px;--h2:28px;--lead:17px;--fs:15px;--gap:32px;--grid-gap:16px;--quote:28px;--full-h:540px}.dfs-split{grid-template-columns:1fr 1fr}.dfs-wide{aspect-ratio:16/9}}
@container dfs (max-width:639px){.dfs-in{--cols-max:2;--px:18px;--py:44px;--py-sm:28px;--h1:34px;--h1-big:40px;--h2:24px;--lead:16px;--gap:24px;--grid-gap:12px;--quote:22px;--full-h:460px}.dfs-split{grid-template-columns:1fr}.dfs-hero-img{aspect-ratio:4/3}.dfs-wide{aspect-ratio:4/3}.dfs-hdr-center{display:none}.dfs-hdr-row.when-center{display:flex}.dfs-wide-only{display:none}.dfs-feat .dfs-grid{--cols:1!important}}
@container dfs (min-width:640px){.dfs-hdr-row.when-center{display:none}.dfs-menu{display:none}}
`
