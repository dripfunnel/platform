import { clsx } from 'clsx'

// The home styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
// The header's column (layout.bar), so every section lines up with the logo and the footer.
const sectionBase = clsx('box-border w-[min(100%,1240px)] mx-auto px-4 min-[900px]:px-8')
const pillBase = clsx('py-0 px-6.5 border-2 inline-flex min-h-12 items-center justify-center gap-x-2 rounded-button font-heading text-[15px] font-extrabold no-underline [transition:background-color_200ms_ease,color_200ms_ease,border-color_200ms_ease] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]')
const eyebrowBase = clsx('m-0 self-start py-1.5 px-3.5 inline-flex rounded-full text-[12px] font-extrabold tracking-[0.08em] uppercase')

export const home = {
  accent: clsx('block text-accent'),
  arrow: clsx('w-4.5 h-4.5 shrink-0 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]'),
  body: clsx('m-0 max-w-[52ch] text-ink-soft text-[16px] leading-[1.65]'),
  button: clsx(pillBase, 'border-accent bg-accent text-accent-ink hover:bg-ink hover:border-ink'),
  buttonLight: clsx(pillBase, 'border-ink bg-transparent text-ink hover:bg-ink hover:text-bg'),
  eyebrow: clsx(eyebrowBase, 'bg-surface text-accent'),
  eyebrowTint: clsx(eyebrowBase, 'bg-tint text-accent'),
  heading: clsx('m-0 font-heading text-[28px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.12] text-ink [text-wrap:balance] min-[900px]:text-[38px]'),
  head: clsx('flex flex-wrap items-end justify-between gap-x-6 gap-y-4'),
  headCopy: clsx('flex min-w-0 flex-col gap-y-3'),
  more: clsx('inline-flex min-h-11 items-center gap-x-2 rounded-full text-accent font-heading text-[15px] font-extrabold no-underline hover:underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]'),
  section: clsx(sectionBase, 'flex flex-col gap-y-7 pt-12 min-[900px]:pt-24'),

  hero: clsx(sectionBase, 'pt-4 min-[900px]:pt-6'),
  heroPanel: clsx('grid overflow-visible rounded-[32px] bg-[linear-gradient(135deg,var(--color-peach),var(--color-tint))] min-[900px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] min-[900px]:rounded-[40px]'),
  heroCopy: clsx('flex flex-col justify-center gap-y-5 py-10 px-6 min-[900px]:py-20 min-[900px]:pl-16 min-[900px]:pr-12'),
  heroTitle: clsx('m-0 font-heading text-[40px] font-[var(--heading-weight)] tracking-[-0.03em] leading-[1.04] text-ink [text-wrap:balance] min-[900px]:text-[64px]'),
  heroLead: clsx('m-0 max-w-[44ch] text-ink-soft text-[17px] leading-[1.6] wrap-anywhere'),
  heroActions: clsx('flex flex-wrap gap-3 pt-2'),
  heroFrame: clsx('relative min-h-0 p-3 pt-0 min-[900px]:p-4 min-[900px]:pl-0'),
  heroPicture: clsx('relative block overflow-hidden h-full aspect-square rounded-[26px] [background:var(--picture)] min-[900px]:aspect-auto min-[900px]:min-h-140 min-[900px]:rounded-[30px]'),
  heroImage: clsx('block w-full h-full object-cover object-[50%_48%] min-[900px]:absolute min-[900px]:inset-0 min-[900px]:object-[50%_30%]'),
  heroDetail: clsx('hidden min-[900px]:block absolute -left-14 bottom-12 w-56 overflow-hidden rounded-[24px] border-[6px] border-surface bg-surface [box-shadow:0_18px_40px_var(--color-tone-3d2232-18)]'),
  heroDetailImage: clsx('block w-full h-auto object-cover'),

  chips: clsx(sectionBase, 'pt-8 min-[900px]:pt-10'),
  chipSkeleton: clsx('inline-flex min-h-11 w-24 shrink-0 rounded-full bg-soft'),
  chipsRow: clsx('p-0 m-0 flex items-center gap-2.5 overflow-x-auto list-none [scrollbar-width:none] pb-1 min-[900px]:flex-wrap min-[900px]:justify-center'),
  chipsLabel: clsx('m-0 shrink-0 pr-2 font-heading text-[15px] font-extrabold text-ink'),
  chip: clsx('py-0 px-5 inline-flex min-h-11 shrink-0 items-center rounded-full border border-line bg-surface text-ink font-heading text-[15px] font-bold whitespace-nowrap no-underline hover:border-accent hover:text-accent [transition:border-color_200ms_ease,color_200ms_ease] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'),
  chipAll: clsx('py-0 px-5 inline-flex min-h-11 shrink-0 items-center gap-x-1.5 rounded-full bg-ink text-bg font-heading text-[15px] font-bold whitespace-nowrap no-underline hover:bg-accent [transition:background-color_200ms_ease] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'),

  routine: clsx(sectionBase, 'pt-12 min-[900px]:pt-24'),
  routinePanel: clsx('grid gap-8 overflow-hidden rounded-[32px] bg-plum text-plum-ink p-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] min-[900px]:items-center min-[900px]:gap-14 min-[900px]:p-12 min-[900px]:rounded-[40px]'),
  routinePicture: clsx('block overflow-hidden aspect-[4/3] rounded-[24px] [background:var(--picture)] min-[900px]:aspect-[4/5]'),
  routineImage: clsx('block w-full h-full object-cover object-[50%_40%]'),
  routineCopy: clsx('flex min-w-0 flex-col gap-y-6'),
  routineEyebrow: clsx(eyebrowBase, 'bg-[var(--color-light-14)] text-plum-ink'),
  routineTitle: clsx('m-0 font-heading text-[28px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.12] [text-wrap:balance] min-[900px]:text-[40px]'),
  routineLead: clsx('m-0 max-w-[50ch] text-[16px] leading-[1.6] text-[var(--color-light-82)]'),
  steps: clsx('p-0 m-0 grid gap-3 list-none min-[700px]:grid-cols-3'),
  step: clsx('flex flex-col gap-y-2 rounded-[22px] bg-[var(--color-light-8)] border border-[var(--color-light-16)] p-5'),
  stepNumber: clsx('inline-flex w-10 h-10 items-center justify-center rounded-full bg-peach text-plum font-heading text-[16px] font-extrabold'),
  stepTitle: clsx('m-0 pt-2 font-heading text-[20px] font-extrabold'),
  stepBody: clsx('m-0 text-[14px] leading-[1.55] text-[var(--color-light-82)]'),
  routineAction: clsx(pillBase, 'self-start border-peach bg-peach text-plum hover:bg-surface hover:border-surface focus-visible:[outline:2px_solid_var(--color-plum-ink)]'),

  tiles: clsx('p-0 m-0 grid gap-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-5'),
  tile: clsx('group/home-tile flex flex-col gap-y-3 rounded-[26px] bg-surface border border-line p-2.5 pb-4 text-ink no-underline hover:border-accent [transition:border-color_200ms_ease] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]'),
  tilePicture: clsx('block overflow-hidden aspect-[4/5] rounded-[20px] [background:var(--picture)]'),
  tileImage: clsx('block w-full h-full object-cover [transition:transform_500ms_ease] group-hover/home-tile:scale-[1.05]'),
  tileFoot: clsx('flex items-center justify-between gap-x-2 px-2'),
  tileName: clsx('min-w-0 font-heading text-[16px] font-extrabold wrap-anywhere min-[900px]:text-[18px]'),
  tileArrow: clsx('inline-flex w-9 h-9 shrink-0 items-center justify-center rounded-full bg-soft text-accent group-hover/home-tile:bg-accent group-hover/home-tile:text-accent-ink [transition:background-color_200ms_ease,color_200ms_ease]'),

  story: clsx(sectionBase, 'grid gap-8 pt-12 items-center min-[900px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] min-[900px]:gap-16 min-[900px]:pt-24'),
  storyPictures: clsx('relative'),
  storyPicture: clsx('block overflow-hidden aspect-[4/3] rounded-[32px] [background:var(--picture-alt)]'),
  storyImage: clsx('block w-full h-full object-cover'),
  storyCopy: clsx('flex min-w-0 flex-col items-start gap-y-5'),

  promises: clsx(sectionBase, 'pt-12 min-[900px]:pt-24'),
  promiseList: clsx('p-0 m-0 grid gap-3 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-4'),
  promise: clsx('flex flex-col gap-3 rounded-[24px] bg-soft p-5 min-[900px]:flex-row min-[900px]:items-center min-[900px]:p-6'),
  promiseIcon: clsx('box-content w-6 h-6 shrink-0 p-3 rounded-full bg-surface text-accent [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]'),
  promiseTitle: clsx('m-0 font-heading text-[16px] font-extrabold text-ink'),
  promiseBody: clsx('m-0 text-[14px] text-muted'),

  signup: clsx(sectionBase, 'pt-12 min-[900px]:pt-24'),
  signupPanel: clsx('grid overflow-hidden rounded-[32px] bg-[linear-gradient(120deg,var(--color-tint),var(--color-peach))] min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] min-[900px]:rounded-[40px]'),
  signupCopy: clsx('flex flex-col items-start gap-y-5 p-8 min-[900px]:py-16 min-[900px]:px-16'),
  signupPicture: clsx('relative block overflow-hidden aspect-[4/3] [background:var(--picture)] min-[900px]:aspect-auto min-[900px]:min-h-full'),
  signupImage: clsx('block w-full h-full object-cover object-[50%_25%] min-[900px]:absolute min-[900px]:inset-0'),
}
