import { clsx } from 'clsx'

// The home styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
// The header's column (layout.bar), so every section lines up with the logo and the footer.
const sectionBase = clsx('box-border w-[min(100%,1240px)] mx-auto px-4 min-[900px]:px-8')
const buttonBase = clsx('py-0 px-8 border inline-flex min-h-12 items-center justify-center rounded-button text-[12px] font-semibold tracking-[0.22em] uppercase no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]')

export const home = {
  arch: clsx('flex flex-col items-center gap-y-4 text-ink no-underline group/arch focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[4px]'),
  archImage: clsx('block w-full h-full object-cover [transition:transform_900ms_ease] group-hover/arch:scale-[1.05] motion-reduce:[transition:none] motion-reduce:group-hover/arch:scale-100'),
  archItem: clsx('w-[calc(50%_-_8px)] min-[700px]:w-[calc((100%_-_48px)/3)] min-[1100px]:w-[calc((100%_-_96px)/5)]'),
  archName: clsx('font-heading text-[20px] leading-[1.2] text-center decoration-gold decoration-1 underline-offset-[6px] group-hover/arch:underline min-[900px]:text-[23px]'),
  archPicture: clsx('block w-full overflow-hidden aspect-[3/4] rounded-t-full border border-line p-1.5 box-border bg-surface [&>img]:rounded-t-full'),
  arches: clsx('p-0 m-0 flex w-full flex-wrap justify-center gap-y-10 gap-x-4 list-none min-[700px]:gap-x-6'),
  assure: clsx(sectionBase, 'py-5 mt-12 m-0 flex list-none flex-col items-center gap-y-2 border-y border-y-line text-center text-ink-soft text-[12px] tracking-[0.18em] uppercase min-[900px]:flex-row min-[900px]:justify-center min-[900px]:gap-x-0 min-[900px]:w-[min(100%_-_64px,1176px)] min-[900px]:px-0'),
  assureItem: clsx('flex items-center min-[900px]:[&+&]:before:content-[""] min-[900px]:[&+&]:before:mx-6 min-[900px]:[&+&]:before:w-1.5 min-[900px]:[&+&]:before:h-1.5 min-[900px]:[&+&]:before:rotate-45 min-[900px]:[&+&]:before:bg-gold'),
  body: clsx('m-0 max-w-[48ch] text-ink-soft text-[16px] leading-[1.7]'),
  button: clsx(buttonBase, 'border-ink bg-ink text-bg hover:bg-[color-mix(in_srgb,var(--color-ink)_86%,var(--color-gold))]'),
  em: clsx('italic text-gold-ink'),
  eyebrow: clsx('m-0 text-gold-ink text-[11px] font-semibold tracking-[0.3em] uppercase'),
  ghost: clsx(buttonBase, 'self-center border-ink bg-transparent text-ink hover:bg-ink hover:text-bg'),
  gift: clsx(sectionBase, 'mt-20 relative grid grid-cols-[minmax(0,1fr)] min-[900px]:mt-28 min-[900px]:block'),
  giftCard: clsx('py-10 px-6 flex flex-col items-center gap-y-4 bg-surface text-center border border-line min-[900px]:absolute min-[900px]:top-1/2 min-[900px]:left-[calc(32px_+_56px)] min-[900px]:-translate-y-1/2 min-[900px]:w-[400px] min-[900px]:py-14 min-[900px]:px-12 min-[900px]:border-0 min-[900px]:outline min-[900px]:outline-1 min-[900px]:outline-gold min-[900px]:-outline-offset-[10px]'),
  giftPicture: clsx('w-full overflow-hidden h-72 [background:var(--picture)] min-[900px]:h-[520px]'),
  giftTitle: clsx('m-0 font-heading text-[34px] font-[var(--heading-weight)] leading-[1.1] min-[900px]:text-[44px]'),
  head: clsx('flex flex-col items-center gap-y-3 text-center'),
  heading: clsx('m-0 font-heading text-[32px] font-[var(--heading-weight)] leading-[1.15] tracking-[var(--heading-spacing)] [text-wrap:balance] min-[900px]:text-[42px]'),
  hero: clsx(sectionBase, 'pt-8 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-8 min-[900px]:pt-12 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)] min-[900px]:gap-x-10 min-[900px]:items-center'),
  heroCopy: clsx('col-[1_/_-1] row-start-1 min-[900px]:col-start-2 min-[900px]:col-end-3 flex flex-col items-center gap-y-5 text-center px-2'),
  heroLeft: clsx('col-start-1 row-start-2 min-[900px]:row-start-1 overflow-hidden [background:var(--picture)] min-[900px]:mb-16'),
  heroRight: clsx('col-start-2 row-start-2 min-[900px]:col-start-3 min-[900px]:row-start-1 overflow-hidden [background:var(--picture)] mt-10 min-[900px]:mt-16'),
  heroTitle: clsx('m-0 font-heading text-[44px] font-[var(--heading-weight)] leading-[1.02] tracking-[-0.005em] [text-wrap:balance] min-[900px]:text-[64px] [&_em]:block'),
  image: clsx('block w-full h-full object-cover'),
  lead: clsx('m-0 max-w-[34ch] text-ink-soft text-[16px] leading-[1.7]'),
  ornament: clsx('block w-30 h-3 [fill:none] [stroke:var(--color-gold)] [stroke-width:1]'),
  section: clsx(sectionBase, 'mt-20 flex flex-col items-center gap-y-10 min-[900px]:mt-28 [&>ul]:w-full'),
  signup: clsx('py-16 px-4 mt-20 -mb-20 flex flex-col items-center gap-y-4 bg-soft text-center min-[900px]:mt-28 min-[900px]:py-20 [&>p]:max-w-[44ch]'),
  stat: clsx('m-0 flex items-baseline gap-x-3 py-4 border-y border-y-line'),
  statLabel: clsx('text-muted text-[12px] tracking-[0.2em] uppercase'),
  statNumber: clsx('font-heading text-[44px] leading-[1] text-gold-ink'),
  story: clsx(sectionBase, 'mt-20 grid grid-cols-[minmax(0,1fr)] items-center gap-y-10 min-[900px]:mt-28 min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] min-[900px]:gap-x-20'),
  storyCopy: clsx('flex flex-col items-start gap-y-5 min-[900px]:pr-10'),
  storyPicture: clsx('overflow-hidden [background:var(--picture)] outline outline-1 outline-gold -outline-offset-[14px]'),
  storyTitle: clsx('m-0 font-heading text-[34px] font-[var(--heading-weight)] leading-[1.1] [text-wrap:balance] min-[900px]:text-[46px] [&_em]:block'),
  textLink: clsx('inline-flex min-h-11 items-center text-ink text-[12px] font-semibold tracking-[0.22em] uppercase underline decoration-gold decoration-1 underline-offset-[8px] hover:text-gold-ink focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'),
}
