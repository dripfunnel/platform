'use client'

import { lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { questionsForVersion } from '../products/questions'
import type { CustomiseIntent } from '../sealed/customise'
import { useCart, type GiftRecipient } from './cart'

// The modal's code is fetched only when a product with questions is bought (storefront ARCHITECTURE §3.5, §9).
const CustomiseModal = lazy(() => import('../sealed/customise').then((m) => ({ default: m.CustomiseModal })))

type Asking = NonNullable<ReturnType<typeof questionsForVersion>>

/** The modal for a product that asks questions, while it's open; nothing for one that doesn't. */
const Ask = ({ asking, versionId, quantity, gift, intent, onClose }: { asking: Asking | null; versionId: string | null; quantity: number; gift: GiftRecipient | null | undefined; intent: CustomiseIntent; onClose: (done: boolean) => void }) =>
  asking && versionId ? (
    <Suspense fallback={null}>
      <CustomiseModal product={asking} versionId={versionId} quantity={quantity} initial={[]} intent={intent} gift={gift} onClose={onClose} />
    </Suspense>
  ) : null

// Add to cart and Buy now (storefront ARCHITECTURE §3.2 "add-to-cart that uses useCart"): the theme words and styles them;
// core does what they do, and marks them so the checkout smoke test (§4.2) finds them in any theme.

type Props = {
  /** The version to buy; null while options are still to choose, which disables the button. */
  versionId: string | null
  quantity?: number
  disabled?: boolean
  className?: string
  children: ReactNode
  /** Hears whether it worked, to say so beside the button. */
  onDone?: (worked: boolean) => void
  /** A gift card's recipient; the engine refuses a gift card without one. */
  gift?: GiftRecipient | null
  /** The id of the words saying why it's disabled, for a screen reader. */
  describedBy?: string | undefined
}

/** Disabled until the engine answers, so pressing again doesn't add the version twice. */
const useOnePress = (onDone: Props['onDone']) => {
  const [busy, setBusy] = useState(false)
  const pressed = useRef(false)
  const press = (act: () => Promise<boolean>) => {
    if (pressed.current) return
    pressed.current = true
    setBusy(true)
    void act().then((worked) => {
      pressed.current = false
      setBusy(false)
      onDone?.(worked)
    })
  }
  return [press, busy] as const
}

/** One button: a product with questions asks them first (CATALOG fact 50), one without does `act` as it always has. */
const CartButton = ({ action, act, intent, versionId, quantity = 1, disabled = false, className, children, onDone, gift, describedBy }: Props & { action: string; act: (versionId: string) => Promise<boolean>; intent: CustomiseIntent }) => {
  const [press, busy] = useOnePress(onDone)
  const [asking, setAsking] = useState<Asking | null>(null)
  const click = () => {
    if (!versionId) return
    const questions = questionsForVersion(versionId)
    if (questions) setAsking(questions)
    else press(() => act(versionId))
  }
  return (
    <>
      <button type="button" className={className} data-df-action={action} aria-describedby={describedBy} disabled={disabled || busy || versionId === null} onClick={click}>
        {children}
      </button>
      <Ask asking={asking} versionId={versionId} quantity={quantity} gift={gift} intent={intent} onClose={(done) => (setAsking(null), done && onDone?.(true))} />
    </>
  )
}

export const AddToCart = (props: Props) => {
  const cart = useCart()
  return <CartButton {...props} action="add-to-cart" intent={{ kind: 'add' }} act={(id) => cart.add(id, props.quantity ?? 1, props.gift ?? undefined)} />
}

export const BuyNow = (props: Props) => {
  const cart = useCart()
  return <CartButton {...props} action="buy-now" intent={{ kind: 'buy' }} act={(id) => cart.buyNow(id, props.quantity ?? 1, props.gift ?? undefined)} />
}
