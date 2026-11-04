'use client'

import { useRef, useState } from 'react'
import { Link, useStorefront, type MenuItem } from '@dripfunnel/storefront-core/theme'

export const NavItem = ({ item }: { item: MenuItem }) => {
  const { t } = useStorefront()
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hovered = useRef(false)
  const focused = useRef(false)
  const show = (value: boolean) => {
    clearTimeout(leaving.current)
    setOpen(value)
  }
  return (
    <div
      className="relative min-[900px]:flex min-[900px]:items-center"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        show(false)
        toggle.current?.focus()
      }}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        hovered.current = true
        show(true)
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'mouse') return
        hovered.current = false
        if (!focused.current) show(false)
      }}
      onFocus={(e) => {
        focused.current = true
        if (e.target === (toggle.current as EventTarget | null)) clearTimeout(leaving.current)
        else show(true)
      }}
      onBlur={() => {
        focused.current = false
        leaving.current = setTimeout(() => setOpen(false), 0)
      }}
    >
      <Link href={item.href} className="py-0 px-3 flex min-h-11 items-center rounded-[8px] text-header-ink text-[15px] font-medium no-underline hover:bg-header-hover focus-visible:[outline:2px_solid_var(--color-header-ink)] focus-visible:outline-offset-[2px]">
        {item.label}
      </Link>
      {item.children.length ? (
        <>
          <button ref={toggle} type="button" className="group/layout-subToggle hidden min-[900px]:p-0 min-[900px]:border-0 min-[900px]:border-current min-[900px]:flex min-[900px]:w-7 min-[900px]:h-11 min-[900px]:items-center min-[900px]:justify-center min-[900px]:bg-transparent min-[900px]:text-header-ink min-[900px]:cursor-pointer" aria-expanded={open} aria-label={t('common.nav.submenu', { item: item.label })} onClick={() => show(hovered.current || !open)}>
            <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-4 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className={open ? `pl-4 flex flex-col min-[900px]:p-2 min-[900px]:border min-[900px]:border-header-hover min-[900px]:absolute min-[900px]:top-[100%] min-[900px]:left-0 min-[900px]:z-20 min-[900px]:hidden min-[900px]:min-w-50 min-[900px]:rounded-[12px] min-[900px]:bg-header-bg min-[900px]:[box-shadow:0_8px_24px_color-mix(in_srgb,var(--color-header-ink)_12%,transparent)] min-[900px]:flex` : 'pl-4 flex flex-col min-[900px]:p-2 min-[900px]:border min-[900px]:border-header-hover min-[900px]:absolute min-[900px]:top-[100%] min-[900px]:left-0 min-[900px]:z-20 min-[900px]:hidden min-[900px]:min-w-50 min-[900px]:rounded-[12px] min-[900px]:bg-header-bg min-[900px]:[box-shadow:0_8px_24px_color-mix(in_srgb,var(--color-header-ink)_12%,transparent)]'}>
            {item.children.map((child) => (
              <Link key={child.id} href={child.href} className="py-0 px-3 flex min-h-10 items-center rounded-[8px] text-header-ink text-[14px] no-underline hover:bg-header-hover">
                {child.label}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
