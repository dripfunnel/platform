import { ShieldCheck, Truck } from 'lucide-react'

export const Perks = () => (
  <ul className="flex gap-6">
    <li className="flex items-center gap-2">
      <Truck aria-hidden className="size-5" /> Free delivery over every city we ship to
    </li>
    <li className="flex items-center gap-2">
      <ShieldCheck aria-hidden className="size-5" /> Secure checkout
    </li>
  </ul>
)
