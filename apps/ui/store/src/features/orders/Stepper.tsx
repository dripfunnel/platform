import { fill, formatCount, messages } from '../../messages'

const words = messages.orders.detail.line

/** "− 2 / 3 +": how many of a line, from none up to `max` (PortalOrders' ship, return and refund pickers). */
export const Stepper = ({ name, value, max, onChange }: { name: string; value: number; max: number; onChange: (value: number) => void }) => (
  <span className="df-order-stepper">
    <button type="button" aria-label={fill(words.fewer, { name })} disabled={value <= 0} onClick={() => onChange(value - 1)}>
      −
    </button>
    <span aria-live="polite">{fill(words.picked, { picked: formatCount(value), left: formatCount(max) })}</span>
    <button type="button" aria-label={fill(words.more, { name })} disabled={value >= max} onClick={() => onChange(value + 1)}>
      +
    </button>
  </span>
)
