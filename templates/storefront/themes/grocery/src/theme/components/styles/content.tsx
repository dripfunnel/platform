import { clsx } from 'clsx'

// The content styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
export const content = {
  answer: clsx('mt-0 mr-0 mb-4 ml-0 text-ink-soft leading-[1.6] whitespace-pre-line'),
  article: clsx('pt-6 pr-4 pb-2 pl-4 flex box-border w-[min(100%,760px)] flex-col gap-y-4 gap-x-4 mx-auto'),
  ask: clsx('group/content-ask py-3 px-0 border-0 border-current flex w-full min-h-14 items-center justify-between gap-y-4 gap-x-4 bg-transparent text-ink [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold text-start cursor-pointer focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]'),
  back: clsx('self-start text-ink-soft text-[14px]'),
  contact: clsx('p-4.5 border border-line flex flex-col gap-y-2 gap-x-2 rounded-card bg-surface'),
  cover: clsx('w-full h-auto rounded-card'),
  excerpt: clsx('m-0 text-muted text-[15px]'),
  faq: clsx('border-t border-t-line grid'),
  heading: clsx('mt-2 mr-0 mb-0 ml-0 font-heading text-[24px] font-[var(--heading-weight)]'),
  image: clsx('w-full h-auto rounded-card'),
  noCover: clsx('aspect-[3/2] rounded-card [background:var(--picture)]'),
  post: clsx('focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] flex flex-col gap-y-2 gap-x-2 text-ink no-underline'),
  postTitle: clsx('m-0 font-heading text-[22px] font-[var(--heading-weight)]'),
  posts: clsx('grid gap-y-6 gap-x-6 min-[700px]:grid-cols-[repeat(2,minmax(0,1fr))] min-[1000px]:grid-cols-[repeat(3,minmax(0,1fr))]'),
  prose: clsx('flex flex-col gap-y-4 gap-x-4'),
  question: clsx('border-b border-b-line'),
  sign: clsx('border-r-[2px] border-b-[2px] border-r-current border-b-current w-2.5 h-2.5 shrink-0 [transform:rotate(45deg)] [transition:transform_0.2s] group-[[aria-expanded="true"]]/content-ask:[transform:rotate(225deg)]'),
  text: clsx('m-0 text-ink text-[17px] leading-[1.65] wrap-anywhere whitespace-pre-line'),
  title: clsx('m-0 font-heading text-[34px] font-[var(--heading-weight)] tracking-[var(--heading-spacing)] leading-[1.15] [text-transform:var(--heading-case)] min-[1000px]:text-[40px]'),
}
