import { clsx } from 'clsx'

// The home styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
// The header's column (layout.bar), so every section lines up with the logo and the footer.
const sectionBase = clsx('box-border w-[min(100%,1240px)] mx-auto px-4 min-[900px]:px-8')
const focus = clsx('focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]')
const promoBase = clsx('relative grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] min-h-44 overflow-hidden rounded-card no-underline min-[900px]:min-h-56', focus)
const pillBase = clsx('py-0 px-4 inline-flex min-h-10 items-center gap-x-1.5 rounded-button text-[14px] font-bold')
const headingBase = clsx('m-0 font-heading text-[21px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.2] [text-transform:var(--heading-case)] [text-wrap:balance] min-[900px]:text-[26px]')

export const home = {
  section: clsx(sectionBase, 'pt-10 min-[900px]:pt-14'),
  head: clsx('mb-4 flex items-end justify-between gap-x-4'),
  heading: headingBase,
  eyebrow: clsx('mt-0 mx-0 mb-1 text-accent text-[12px] font-bold tracking-[0.08em] uppercase'),
  more: clsx('inline-flex min-h-10 shrink-0 items-center gap-x-1 text-accent text-[14px] font-bold no-underline hover:underline', focus),
  arrow: clsx('w-4 h-4 shrink-0 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2.2]'),

  hero: clsx(sectionBase, 'pt-4 min-[900px]:pt-6'),
  intro: clsx('relative grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-card bg-soft min-[700px]:grid-cols-[minmax(0,1fr)_minmax(0,300px)] min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,420px)]'),
  introCopy: clsx('py-5 px-5 flex flex-col items-start gap-y-2 min-[900px]:py-8 min-[900px]:px-9'),
  introEyebrow: clsx('m-0 py-1 px-2.5 rounded-[6px] bg-highlight text-highlight-ink text-[12px] font-bold'),
  title: clsx('m-0 font-heading text-[26px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] [text-wrap:balance] min-[900px]:text-[38px]'),
  lead: clsx('m-0 max-w-[46ch] text-ink-soft text-[15px] min-[900px]:text-[16px]'),
  introSearch: clsx(pillBase, 'mt-2 bg-accent text-accent-ink no-underline hover:bg-header-hover', focus),
  introPicture: clsx('hidden min-[700px]:block min-[700px]:relative'),
  introImage: clsx('block absolute inset-0 w-full h-full object-cover'),

  tiles: clsx('m-0 mt-4 p-0 list-none grid gap-x-2.5 gap-y-4 grid-cols-[repeat(4,minmax(0,1fr))] min-[600px]:grid-cols-[repeat(5,minmax(0,1fr))] min-[900px]:mt-5 min-[900px]:gap-x-4 min-[900px]:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]'),
  tile: clsx('group/home-tile flex flex-col items-center gap-y-2 text-ink text-center no-underline rounded-card', focus),
  tilePicture: clsx('relative block w-full overflow-hidden aspect-square rounded-card [background:var(--picture)] [transition:box-shadow_200ms_ease] group-hover/home-tile:[box-shadow:0_0_0_2px_var(--color-accent)]'),
  tileImage: clsx('block w-full h-full object-cover [transition:transform_300ms_ease] group-hover/home-tile:scale-105 motion-reduce:group-hover/home-tile:scale-100'),
  tileName: clsx('text-[12px] font-semibold leading-[1.25] wrap-anywhere min-[900px]:text-[14px]'),
  allPicture: clsx('flex w-full aspect-square flex-col items-center justify-center gap-y-1 rounded-card bg-highlight text-highlight-ink [transition:box-shadow_200ms_ease] group-hover/home-tile:[box-shadow:0_0_0_2px_var(--color-accent)]'),
  allIcon: clsx('w-8 h-8 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2] min-[900px]:w-10 min-[900px]:h-10'),
  allNote: clsx('hidden text-[12px] font-semibold min-[900px]:block'),
  placeholder: clsx('block w-full aspect-square rounded-card bg-soft'),

  promos: clsx(sectionBase, 'pt-8 m-0 list-none grid gap-3 grid-cols-[minmax(0,1fr)] min-[800px]:grid-cols-[repeat(2,minmax(0,1fr))] min-[900px]:gap-4 min-[900px]:pt-10'),
  promoNew: clsx(promoBase, 'bg-accent text-accent-ink'),
  promoValue: clsx(promoBase, 'bg-highlight text-highlight-ink'),
  promoCopy: clsx('p-5 flex flex-col items-start justify-center gap-y-2 min-[900px]:p-7'),
  promoEyebrow: clsx('m-0 text-[12px] font-bold tracking-[0.08em] uppercase opacity-90'),
  promoTitle: clsx(headingBase, 'text-[19px] min-[900px]:text-[24px]'),
  promoActionLight: clsx(pillBase, 'mt-1 bg-surface text-accent'),
  promoActionDark: clsx(pillBase, 'mt-1 bg-ink text-bg'),
  promoPicture: clsx('relative'),
  promoImage: clsx('block absolute inset-0 w-full h-full object-cover'),

  grid: clsx('m-0 p-0 list-none grid gap-3 grid-cols-[repeat(2,minmax(0,1fr))] min-[600px]:grid-cols-[repeat(3,minmax(0,1fr))] min-[900px]:gap-4 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))] min-[1100px]:grid-cols-[repeat(6,minmax(0,1fr))]'),
  cell: clsx('min-w-0'),

  band: clsx('mt-12 py-8 bg-tint min-[900px]:mt-16 min-[900px]:py-12'),
  bandInner: clsx(sectionBase),
  rail: clsx('m-0 p-0 pb-2 list-none flex gap-3 overflow-x-auto [scroll-snap-type:x_mandatory] [scrollbar-width:thin] min-[900px]:gap-4'),
  railItem: clsx('shrink-0 w-[44%] [scroll-snap-align:start] min-[600px]:w-[30%] min-[900px]:w-[calc((100%_-_80px)/5.5)]'),

  story: clsx(sectionBase, 'pt-12 min-[900px]:pt-16'),
  storyInner: clsx('grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-card bg-soft min-[800px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'),
  storyPicture: clsx('relative min-h-56 min-[800px]:min-h-90'),
  storyImage: clsx('block absolute inset-0 w-full h-full object-cover'),
  storyCopy: clsx('p-6 flex flex-col items-start justify-center gap-y-3 min-[900px]:py-12 min-[900px]:px-14'),
  storyBody: clsx('m-0 max-w-[52ch] text-ink-soft text-[15px] min-[900px]:text-[16px]'),
  storyLink: clsx(pillBase, 'mt-1 border border-accent text-accent no-underline hover:bg-accent hover:text-accent-ink', focus),

  promises: clsx(sectionBase, 'pt-12 min-[900px]:pt-16'),
  promiseList: clsx('m-0 p-0 list-none grid gap-3 grid-cols-[repeat(2,minmax(0,1fr))] min-[900px]:gap-4 min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]'),
  promise: clsx('p-3.5 flex flex-col items-start gap-x-3 gap-y-2 rounded-card border border-line bg-surface min-[600px]:flex-row min-[600px]:items-center min-[900px]:p-4'),
  promiseIcon: clsx('box-border p-2.5 w-11 h-11 shrink-0 rounded-full bg-soft text-accent [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]'),
  promiseTitle: clsx('m-0 text-[14px] font-bold'),
  promiseBody: clsx('m-0 text-muted text-[13px]'),

  signup: clsx(sectionBase, 'pt-12 min-[900px]:pt-16'),
  signupInner: clsx('p-6 flex flex-col items-start gap-4 rounded-card bg-accent text-accent-ink min-[800px]:flex-row min-[800px]:items-center min-[800px]:justify-between min-[900px]:py-9 min-[900px]:px-12'),
  signupCopy: clsx('flex flex-col gap-y-1.5'),
  signupBody: clsx('m-0 max-w-[56ch] text-[15px] opacity-95'),
  signupAction: clsx(pillBase, 'min-h-12 px-6 shrink-0 bg-highlight text-highlight-ink no-underline hover:[filter:brightness(0.96)] focus-visible:[outline:2px_solid_var(--color-accent-ink)] focus-visible:outline-offset-[3px]'),
}
