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
      className="group/layout-navItem relative min-[900px]:flex min-[900px]:items-center"
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
      <Link href={item.href} className="py-0 px-3 flex min-h-11 items-center rounded-button text-ink text-[13px] font-semibold tracking-[0.06em] no-underline uppercase hover:text-accent hover:underline hover:underline-offset-[4px] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px] min-[900px]:group-[:nth-child(n)]/layout-navItem:pr-0.5">
        {item.label}
      </Link>
      {item.children.length ? (
        <>
          <button ref={toggle} type="button" className="group/layout-subToggle hidden min-[900px]:p-0 min-[900px]:border-0 min-[900px]:border-current min-[900px]:flex min-[900px]:w-6 min-[900px]:h-11 min-[900px]:items-center min-[900px]:justify-center min-[900px]:bg-transparent min-[900px]:text-ink min-[900px]:cursor-pointer" aria-expanded={open} aria-label={t('common.nav.submenu', { item: item.label })} onClick={() => show(hovered.current || !open)}>
            <svg className="w-5.5 h-5.5 [fill:none] [stroke:currentcolor] [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6] min-[900px]:group-[:nth-child(n)]/layout-subToggle:w-3.5 min-[900px]:group-[:nth-child(n)]/layout-subToggle:h-3.5" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className={open ? `pl-4 flex flex-col min-[900px]:p-2 min-[900px]:border min-[900px]:border-line min-[900px]:absolute min-[900px]:top-[100%] min-[900px]:left-0 min-[900px]:z-20 min-[900px]:hidden min-[900px]:min-w-50 min-[900px]:rounded-card min-[900px]:bg-surface min-[900px]:[box-shadow:0_8px_24px_rgb(42_39_37_/_12%)] min-[900px]:flex` : 'pl-4 flex flex-col min-[900px]:p-2 min-[900px]:border min-[900px]:border-line min-[900px]:absolute min-[900px]:top-[100%] min-[900px]:left-0 min-[900px]:z-20 min-[900px]:hidden min-[900px]:min-w-50 min-[900px]:rounded-card min-[900px]:bg-surface min-[900px]:[box-shadow:0_8px_24px_rgb(42_39_37_/_12%)]'}>
            {item.children.map((child) => (
              <Link key={child.id} href={child.href} className="py-0 px-3 flex min-h-10 items-center rounded-button text-ink text-[14px] no-underline hover:bg-soft hover:text-accent focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
                {child.label}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
