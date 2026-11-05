import { clsx } from 'clsx'

// The page styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
export const page = {
  action: clsx('py-0 px-5.5 inline-flex min-h-12 items-center rounded-button bg-accent text-accent-ink font-semibold no-underline hover:[filter:brightness(0.94)] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'),
  choice: clsx('focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] py-0 px-4.5 border border-line flex min-h-14 items-center rounded-card bg-surface text-ink font-semibold no-underline'),
  choices: clsx('grid w-full max-w-[560px] gap-y-3 gap-x-3'),
  detail: clsx('flex flex-col'),
  details: clsx('mt-2 mr-0 mb-0 ml-0 grid gap-y-3.5 gap-x-3.5'),
  lead: clsx('m-0 max-w-[56ch] text-ink-soft text-[16px]'),
  page: clsx('pt-10 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col items-start gap-y-3.5 gap-x-3.5 mx-auto min-[900px]:pt-14 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8'),
  picture: clsx('min-h-70 mx-4 rounded-card [background:var(--picture-alt)] min-[900px]:mt-14 min-[900px]:mr-8 min-[900px]:mb-0 min-[900px]:ml-0 min-[900px]:min-h-120'),
  split: clsx('grid box-border grid-cols-[minmax(0,1fr)] w-[min(100%,1240px)] gap-y-6 gap-x-6 mx-auto min-[900px]:items-start min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'),
  term: clsx('text-muted text-[12px] tracking-[0.08em] uppercase'),
  title: clsx('m-0 max-w-[22ch] font-heading text-[32px] font-[var(--heading-weight)] tracking-[-0.01em] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[40px]'),
  value: clsx('m-0 text-[16px] wrap-anywhere'),
}
