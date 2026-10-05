import { Icon, initials } from '@dripfunnel/shared/ui'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { rememberActing } from '../../acting'
import { switchStore, type StoreChoice } from '../../api/shell'
import { fill, messages } from '../../messages'
import { merchantRoles } from '../../nav'

const words = messages.shell.switcher

const keyOf = (c: Pick<StoreChoice, 'store' | 'seller'>) => `${c.store.id}:${c.seller?.id ?? ''}`

/** "Owner", or "Supplier · Northwind Textiles": what the person is in that store. */
export const choiceLabel = (choice: Pick<StoreChoice, 'role' | 'seller'>): string => {
  if (choice.seller) return fill(messages.chooseStore.supplier, { seller: choice.seller.name })
  const role = merchantRoles.find((r) => r === choice.role)
  return role ? messages.shell.roles[role] : choice.role
}

// The header's store switcher (FIRST-RELEASE.md §3.2): the acting store's initial and name; its menu
// lists the person's stores under this partner, never another partner's (the API's myStores).
export const StoreSwitcher = ({ current, stores }: { current: StoreChoice; stores: readonly StoreChoice[] }) => {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const router = useRouter()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    wrapperRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus()
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const choose = async (choice: StoreChoice) => {
    setOpen(false)
    if (keyOf(choice) === keyOf(current)) return
    try {
      const confirmed = await switchStore(choice.store.id, choice.seller?.id ?? null)
      rememberActing({ storeId: confirmed.store.id, supplierId: confirmed.seller?.id ?? null })
      setFailed(false)
      await navigate({ to: '/home' })
      await router.invalidate()
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="df-switcher" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="df-switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={fill(words.label, { store: current.store.name })}
        title={words.title}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="df-switcher-initial" aria-hidden="true">
          {initials(current.store.name).slice(0, 1)}
        </span>
        <span className="df-switcher-name">{current.store.name}</span>
        <span className="df-switcher-caret" aria-hidden="true">
          <Icon name="caret" size={14} />
        </span>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={words.title} className="df-switcher-menu">
          {stores.map((choice) => {
            const selected = keyOf(choice) === keyOf(current)
            return (
              <button key={keyOf(choice)} type="button" role="menuitemradio" aria-checked={selected} className="df-switcher-item" onClick={() => void choose(choice)}>
                <span className="df-switcher-initial" aria-hidden="true">
                  {initials(choice.store.name).slice(0, 1)}
                </span>
                <span className="df-switcher-item-text">
                  <span>{choice.store.name}</span>
                  <small>{choiceLabel(choice)}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {failed && (
        <p role="alert" className="df-switcher-error">
          {words.failed}
        </p>
      )}
    </div>
  )
}
