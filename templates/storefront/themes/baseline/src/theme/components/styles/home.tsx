import { clsx } from 'clsx'

// The home styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
export const home = {
  actions: clsx('flex flex-wrap gap-y-3 gap-x-3'),
  body: clsx('m-0 max-w-[52ch] text-ink-soft text-[16px]'),
  button: clsx('py-0 px-5.5 border border-accent inline-flex min-h-12 items-center justify-center rounded-button bg-accent text-accent-ink text-[15px] font-semibold no-underline hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'),
  copy: clsx('py-9 px-5 flex flex-col items-start justify-center gap-y-3.5 gap-x-3.5 bg-tint min-[900px]:py-14 min-[900px]:px-12'),
  eyebrow: clsx('m-0 text-muted text-[12px] tracking-[0.12em] uppercase'),
  ghost: clsx('py-0 px-5.5 border border-ink-soft inline-flex min-h-12 items-center justify-center rounded-button text-[15px] font-semibold no-underline bg-transparent text-ink focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'),
  heading: clsx('m-0 font-heading text-[26px] font-[var(--heading-weight)] leading-[1.2] [text-transform:var(--heading-case)] min-[900px]:text-[30px]'),
  hero: clsx('grid grid-cols-[minmax(0,1fr)] min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'),
  lead: clsx('m-0 max-w-[42ch] text-ink-soft text-[17px] wrap-anywhere'),
  picture: clsx('min-h-65 [background:var(--picture)] min-[900px]:min-h-110'),
  pictureImage: clsx('block w-full h-full object-cover'),
  signup: clsx('p-6 mt-14 mr-auto mb-0 ml-auto border border-line flex box-border w-[min(100%_-_32px,640px)] flex-col items-center gap-y-3 gap-x-3 rounded-card bg-surface text-center'),
  story: clsx('pt-12 pr-4 pb-0 pl-4 grid box-border grid-cols-[minmax(0,1fr)] w-[min(100%,1240px)] items-center gap-y-6 gap-x-6 mx-auto min-[900px]:pt-18 min-[900px]:pr-8 min-[900px]:pb-0 min-[900px]:pl-8 min-[900px]:gap-y-14 min-[900px]:gap-x-14 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'),
  storyCopy: clsx('flex flex-col items-start gap-y-3.5 gap-x-3.5'),
  storyPicture: clsx('min-h-60 rounded-card [background:var(--picture-alt)] min-[900px]:min-h-105'),
  tile: clsx('relative block overflow-hidden aspect-[1] rounded-card [background:var(--picture-alt)] text-ink no-underline focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]'),
  tileImage: clsx('block w-full h-full object-cover'),
  tileName: clsx('py-1.5 px-3 absolute bottom-3 left-3 rounded-full bg-surface text-[14px] font-semibold'),
  tiles: clsx('p-0 m-0 grid gap-y-3.5 gap-x-3.5 grid-cols-[repeat(2,minmax(0,1fr))] list-none min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))]'),
  title: clsx('m-0 max-w-[16ch] font-heading text-[36px] font-[var(--heading-weight)] tracking-[-0.01em] leading-[1.12] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[52px]'),
}
