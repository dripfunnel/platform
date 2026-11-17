import { clsx } from 'clsx'

// The home styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
// The header's column (layout.bar), so every section lines up with the logo and the footer.
const sectionBase = clsx('box-border w-[min(100%,1240px)] mx-auto px-4 min-[900px]:px-8')
const focus = clsx('focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[3px]')
const buttonBase = clsx('py-0 px-6 inline-flex min-h-12 items-center justify-center gap-x-2 rounded-button text-[15px] font-semibold no-underline', focus)
const eyebrowBase = clsx('m-0 text-[12px] font-bold tracking-[0.2em] uppercase')
const headingBase = clsx('m-0 font-heading font-[var(--heading-weight)] tracking-[var(--heading-spacing)] [text-wrap:balance]')
const gridBase = clsx('p-0 m-0 grid list-none grid-cols-[repeat(2,minmax(0,1fr))] gap-x-4 gap-y-8')

export const home = {
  accent: clsx('italic text-accent'),
  actions: clsx('pt-2 flex flex-wrap items-center gap-x-5 gap-y-3'),
  arrow: clsx('w-4 h-4 shrink-0 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]'),
  banner: clsx('grid overflow-hidden rounded-card bg-olive text-footer-ink min-[900px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]'),
  bannerBody: clsx('m-0 max-w-[40ch] text-footer-muted text-[16px] leading-[1.65]'),
  bannerCopy: clsx('p-8 flex flex-col items-start justify-center gap-y-4 [order:2] min-[900px]:p-14 min-[900px]:[order:0]'),
  bannerPicture: clsx('relative min-h-70 [background:var(--picture)] min-[900px]:min-h-[500px]'),
  bannerTitle: clsx(headingBase, 'text-footer-ink text-[32px] leading-[1.1] min-[900px]:text-[44px]'),
  body: clsx('m-0 max-w-[46ch] text-ink-soft text-[17px] leading-[1.7]'),
  button: clsx(buttonBase, 'bg-accent text-accent-ink hover:bg-ink'),
  buttonLight: clsx(buttonBase, 'mt-2 bg-footer-ink text-olive hover:bg-surface'),
  buttonLinen: clsx(buttonBase, 'mt-2 px-8 bg-bg text-accent hover:bg-surface'),
  cell: clsx('min-w-0'),
  collage: clsx('relative w-full aspect-[1/1] min-[900px]:aspect-[6/5]'),
  collageMain: clsx('absolute top-0 left-0 w-[62%] h-[88%] overflow-hidden rounded-card [background:var(--picture)]'),
  collageSide: clsx('absolute right-[6%] bottom-0 w-[46%] aspect-[3/2] overflow-hidden rounded-card [background:var(--picture-alt)] [box-shadow:0_0_0_6px_var(--color-bg)] min-[900px]:[box-shadow:0_0_0_10px_var(--color-bg)]'),
  collageTop: clsx('absolute top-[8%] right-0 w-[34%] aspect-[3/4] overflow-hidden rounded-card [background:var(--picture-alt)]'),
  cover: clsx('absolute inset-0 block w-full h-full object-cover'),
  eyebrow: clsx(eyebrowBase, 'text-accent'),
  eyebrowLight: clsx(eyebrowBase, 'text-footer-muted'),
  ghost: clsx(buttonBase, 'border border-ink text-ink hover:bg-ink hover:text-bg'),
  gridFour: clsx(gridBase, 'min-[900px]:grid-cols-[repeat(4,minmax(0,1fr))] min-[900px]:gap-x-6 min-[900px]:gap-y-10'),
  gridThree: clsx(gridBase, 'min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))] min-[900px]:gap-x-8 min-[900px]:gap-y-12'),
  head: clsx('flex flex-wrap items-end justify-between gap-x-6 gap-y-3'),
  headCopy: clsx('flex flex-col gap-y-2'),
  heading: clsx(headingBase, 'text-[30px] leading-[1.12] min-[900px]:text-[40px]'),
  hero: clsx('relative'),
  heroCard: clsx(
    'relative z-1 -mt-20 mx-4 p-6 flex flex-col items-start gap-y-4 rounded-card bg-surface [box-shadow:0_18px_48px_rgb(47_43_34/0.16)]',
    'min-[900px]:absolute min-[900px]:mt-0 min-[900px]:mx-0 min-[900px]:bottom-14 min-[900px]:left-[max(32px,calc((100%_-_1240px)/2_+_32px))] min-[900px]:w-[min(500px,44%)] min-[900px]:box-border min-[900px]:p-11',
  ),
  heroPicture: clsx('relative w-full h-[58vh] min-h-90 max-h-[560px] overflow-hidden [background:var(--picture)] min-[900px]:h-[min(82vh,780px)] min-[900px]:min-h-[560px] min-[900px]:max-h-none'),
  heroTitle: clsx(headingBase, 'text-[34px] leading-[1.08] min-[900px]:text-[52px]'),
  lead: clsx('m-0 max-w-[42ch] text-ink-soft text-[16px] leading-[1.65]'),
  more: clsx('inline-flex min-h-11 items-center gap-x-2 text-ink text-[14px] font-semibold underline underline-offset-[6px] decoration-1 hover:text-accent', focus),
  promise: clsx('py-6 flex flex-col items-center gap-y-1 text-center min-[900px]:px-8 min-[900px]:py-9'),
  promiseBody: clsx('m-0 max-w-[30ch] text-muted text-[15px]'),
  promiseTitle: clsx(headingBase, 'text-[22px] leading-[1.2]'),
  promises: clsx('p-0 m-0 grid list-none border-y border-line divide-y divide-line min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))] min-[900px]:divide-y-0 min-[900px]:divide-x'),
  quiet: clsx('inline-flex min-h-12 items-center text-ink text-[15px] font-semibold underline underline-offset-[6px] decoration-1 hover:text-accent', focus),
  quote: clsx('mt-20 bg-sage text-olive min-[900px]:mt-28'),
  quoteBy: clsx('m-0 text-sage-ink text-[13px] font-bold tracking-[0.2em] uppercase'),
  quoteInner: clsx(sectionBase, 'py-16 mt-0 mb-0 flex flex-col items-center gap-y-6 text-center min-[900px]:py-24'),
  quoteLine: clsx(headingBase, 'mx-auto max-w-[26ch] italic text-[28px] leading-[1.28] min-[900px]:text-[44px]'),
  room: clsx(
    'min-w-0 h-48 [&:first-child]:col-span-2 [&:first-child]:h-60 [&:nth-child(4):last-child]:col-span-2',
    'min-[900px]:col-span-2 min-[900px]:h-[300px] min-[900px]:[&:nth-child(-n+2)]:col-span-3 min-[900px]:[&:nth-child(-n+2)]:h-[400px] min-[900px]:[&:nth-child(3):last-child]:col-span-6 min-[900px]:[&:nth-child(4):last-child]:col-span-4 min-[900px]:[&:only-child]:col-span-6',
  ),
  roomCopy: clsx('pt-24 pb-5 px-5 absolute inset-x-0 bottom-0 flex items-end justify-between gap-x-4 bg-[linear-gradient(0deg,rgb(30_26_18/0.78),rgb(30_26_18/0.32)_55%,rgb(30_26_18/0))] [text-shadow:0_1px_12px_rgb(30_26_18/0.35)] text-[#fff] min-[900px]:px-7 min-[900px]:pb-7'),
  roomImage: clsx('absolute inset-0 block w-full h-full object-cover [transition:transform_700ms_ease] group-hover/room:scale-[1.04] motion-reduce:[transition:none]'),
  roomLink: clsx('group/room relative block h-full overflow-hidden rounded-card [background:var(--picture)] text-[#fff] no-underline', focus),
  roomMore: clsx('hidden items-center gap-x-2 text-[12px] font-bold tracking-[0.18em] uppercase min-[900px]:inline-flex'),
  roomName: clsx('font-heading text-[22px] leading-[1.1] wrap-anywhere min-[900px]:text-[30px]'),
  rooms: clsx('p-0 m-0 grid list-none grid-cols-[repeat(2,minmax(0,1fr))] gap-3 min-[900px]:grid-cols-[repeat(6,minmax(0,1fr))] min-[900px]:gap-5'),
  section: clsx(sectionBase, 'pt-16 flex flex-col gap-y-8 min-[900px]:pt-24 min-[900px]:gap-y-10'),
  signup: clsx('py-14 px-6 flex flex-col items-center gap-y-4 rounded-card bg-accent text-accent-ink text-center min-[900px]:py-20'),
  signupBody: clsx('m-0 max-w-[50ch] text-[16px] leading-[1.65]'),
  signupTitle: clsx(headingBase, 'text-[32px] leading-[1.1] min-[900px]:text-[44px]'),
  stat: clsx('py-5 m-0 flex w-full items-baseline gap-x-3 border-y border-line'),
  statLabel: clsx('text-muted text-[13px] font-bold tracking-[0.18em] uppercase'),
  statNumber: clsx('font-heading text-[56px] leading-[1] text-accent'),
  story: clsx(sectionBase, 'pt-20 grid items-center gap-y-12 gap-x-16 min-[900px]:pt-28 min-[900px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]'),
  storyCopy: clsx('flex flex-col items-start gap-y-5'),
  storyTitle: clsx(headingBase, 'text-[32px] leading-[1.1] min-[900px]:text-[46px]'),
}
