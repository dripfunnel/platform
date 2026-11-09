import type { Order, OrderLine, OrderLineAnswer, OrderPart } from '../../api/order'
import { fill, formatCount, messages } from '../../messages'
import { leftToShip, lineName } from './orderDetail'
import { Stepper } from './Stepper'
import { moneyText, type OrdersAccess } from './orderView'

const words = messages.orders.detail

export type Picks = Readonly<Record<string, number>>

const groupTitle = (part: OrderPart, supplier: boolean) => (supplier || part.supplierId === null ? words.groups.mine : fill(words.groups.supplier, { supplier: part.supplierName ?? '' }))

const groupState = (order: Order, part: OrderPart): { text: string; done: boolean } => {
  if (order.state === 'cancelled' || part.state === 'cancelled') return { text: words.groups.cancelled, done: true }
  const left = part.lines.reduce((sum, l) => sum + l.quantity - l.fulfilledQuantity, 0)
  return left > 0 ? { text: fill(words.groups.toShip, { count: formatCount(left) }), done: false } : { text: words.groups.allShipped, done: true }
}

const lineState = (line: OrderLine, part: OrderPart): string => {
  if (line.fulfilledQuantity > 0) return fill(words.line.shipped, { shipped: formatCount(line.fulfilledQuantity), count: formatCount(line.quantity) })
  if (part.shippingMode === 'to-store' && line.sentToStoreQuantity > 0) return fill(words.line.sent, { sent: formatCount(line.sentToStoreQuantity), count: formatCount(line.quantity) })
  return words.line.notShipped
}

const inlineImage = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** A file of an answer: a thumbnail for what every browser draws, else a download link; no link for support (DATA-MODEL §7.11). */
const AnswerFile = ({ file, n }: { file: OrderLineAnswer['files'][number]; n: number }) => {
  const name = fill(file.mime === 'application/pdf' ? words.line.answers.pdf : words.line.answers.photo, { n: formatCount(n) })
  if (!file.url) return <span>{fill(words.line.answers.noLink, { name })}</span>
  if (inlineImage.has(file.mime)) {
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="df-order-answer-thumb">
        <img src={file.url} alt={name} width={48} height={48} loading="lazy" />
      </a>
    )
  }
  return (
    <a href={file.url} rel="noreferrer" download>
      {fill(words.line.answers.download, { name })}
    </a>
  )
}

/** A customised line's answers as placed (#1371): each question, what was answered, and its extra when the caller sees money. */
const LineAnswers = ({ answers, money }: { answers: readonly OrderLineAnswer[]; money: boolean }) => (
  <dl className="df-order-answers" aria-label={words.line.answers.label}>
    {answers.map((a, i) => (
      <div key={`${a.question}-${i}`} className="df-order-answer">
        <dt>{a.question}</dt>
        <dd>
          {a.kind === 'CHOICE' && a.choices.map((c) => (c.quantity > 1 ? fill(words.line.answers.choice, { label: c.label, count: formatCount(c.quantity) }) : c.label) + (c.free > 0 ? ` (${words.line.answers.free})` : '')).join(', ')}
          {a.kind === 'TEXT' && a.text}
          {a.kind === 'UPLOAD' && (
            <span className="df-order-answer-files">
              {a.files.map((f, j) => (
                <AnswerFile key={f.id} file={f} n={j + 1} />
              ))}
            </span>
          )}
          {money && BigInt(a.amount.amount) > 0n && (
            <span className="df-order-sub">
              {' '}
              {moneyText(a.amount)}
              {a.per === 'line' ? ` · ${words.line.answers.perLine}` : ''}
            </span>
          )}
        </dd>
      </div>
    ))}
  </dl>
)

export interface OrderPartsProps {
  order: Order
  access: OrdersAccess
  /** The quantities picked to ship, while the ship form is open. */
  picks: Picks | null
  onPick: (lineId: string, quantity: number) => void
}

/** The lines grouped by who packs them ("You pack these", "{Supplier} packs these"), and the ship steppers. */
export const OrderParts = ({ order, access, picks, onPick }: OrderPartsProps) => (
  <>
    {order.parts.map((part) => {
      const state = groupState(order, part)
      return (
        <section key={part.id} className="df-order-card df-order-part" aria-label={groupTitle(part, access.supplier)}>
          <header className="df-order-part-head">
            <strong>{groupTitle(part, access.supplier)}</strong>
            <span className={state.done ? 'df-order-part-state df-order-part-state--done' : 'df-order-part-state'}>{state.text}</span>
          </header>
          {part.lines.map((line) => {
            const left = leftToShip(line, part, access.supplier)
            const picked = picks?.[line.id] ?? 0
            const name = lineName(line)
            return (
              <div key={line.id} className="df-order-line-wrap">
                <div className="df-order-line" data-money={access.money || undefined}>
                  <span className="df-order-line-name">
                    <span>{name}</span>
                    <span className="df-order-sub">{lineState(line, part)}</span>
                  </span>
                  <span className="df-order-line-qty">{fill(words.line.quantity, { count: formatCount(line.quantity) })}</span>
                  {access.money && <span className="df-order-line-total">{line.total ? moneyText(line.total) : moneyText(line.amount)}</span>}
                </div>
                {line.answers && line.answers.length > 0 && <LineAnswers answers={line.answers} money={access.money} />}
                {picks && left > 0 && (
                  <div className="df-order-pick">
                    <span>{words.line.shipNow}</span>
                    <Stepper name={name} value={picked} max={left} onChange={(value) => onPick(line.id, value)} />
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )
    })}
  </>
)

/** Every line the caller can send now, picked in full, as the prototype opens the form. */
export const allLeft = (order: Order, supplier: boolean): Record<string, number> =>
  Object.fromEntries(order.parts.flatMap((part) => part.lines.map((line) => [line.id, leftToShip(line, part, supplier)] as const).filter(([, left]) => left > 0)))
