'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export const Menu = ({ label, children }: { label: string; children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const close = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return
    setOpen(false)
    toggle.current?.focus()
  }
  return (
    <div className="contents" onKeyDown={close}>
      <button ref={toggle} type="button" className="p-0 border-0 border-current inline-flex min-w-11 h-11 items-center justify-center rounded-full bg-transparent [color:inherit] cursor-pointer [order:2] focus-visible:[outline:2px_solid_currentcolor] focus-visible:outline-offset-[2px] min-[900px]:hidden" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)}>
        <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'} />
        </svg>
        <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{label}</span>
      </button>
      <div id="site-menu" className={open ? 'block basis-[100%] [order:3] min-[900px]:block min-[900px]:basis-[auto] min-[900px]:[order:0]' : 'hidden min-[900px]:block min-[900px]:basis-[auto] min-[900px]:[order:0]'}>
        {children}
      </div>
    </div>
  )
}
