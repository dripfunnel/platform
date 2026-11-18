import { clsx } from 'clsx'

// The menu styles' Tailwind classes, by the names the theme's markup uses (storefront ARCHITECTURE §3.4 "Classes").
export const menu = {
  icon: clsx('w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-width:1.6]'),
  label: clsx('absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap'),
  menu: clsx('contents'),
  open: clsx('block basis-[100%] [order:3] min-[900px]:block min-[900px]:basis-[auto] min-[900px]:[order:0]'),
  panel: clsx('hidden min-[900px]:block min-[900px]:basis-[auto] min-[900px]:[order:0]'),
  toggle: clsx('p-0 border-0 border-current inline-flex min-w-11 h-11 items-center justify-center rounded-full bg-transparent [color:inherit] cursor-pointer [order:2] focus-visible:[outline:2px_solid_currentcolor] focus-visible:outline-offset-[2px] min-[900px]:hidden'),
}
