import { EmptyState, ErrorState, firstName, LoadingState, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadHome, loadLocaleFacts, type HomeOrder, type StoreHome, type StoreLocaleFacts } from '../../api/home'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { merchantStatus, moneyText } from '../orders/orderView'
import { homeSample, homeStates, type HomeState } from './homeStates'
import { dateLineOf, greetingOf, numbersOf, setupOf, tasksOf, type NumberCard, type SetupItem, type Task } from './homeView'
import './home.css'

const words = messages.home
const shellRoute = getRouteApi('/_app')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; home: StoreHome; locale: StoreLocaleFacts | null }

interface HomeSeat {
  supplier: boolean
  /** The checklist's country, currency and language are the Owner's (`settings`). */
  owner: boolean
  reports: boolean
  readOnly: boolean
}

const seatOf = (forced: HomeState | null, acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean): HomeSeat => {
  if (forced === 'denied') return { supplier: true, owner: false, reports: false, readOnly: false }
  if (forced === 'manager' || forced === 'newManager') return { supplier: false, owner: false, reports: true, readOnly: false }
  if (forced === 'staff' || forced === 'newStaff') return { supplier: false, owner: false, reports: false, readOnly: false }
  if (forced) return { supplier: false, owner: true, reports: true, readOnly: forced === 'readOnly' }
  const has = (p: string) => acting.permissions.includes(p)
  return { supplier: acting.seller !== null, owner: has('settings'), reports: has('reports.read'), readOnly }
}

const statusTone = { toShip: 'brand', partly: 'warning', shipped: 'success', refunded: 'muted', cancelled: 'muted' } as const

/** Home (PortalHome, FIRST-RELEASE §5): what needs the seat, the checklist for a new store, the numbers and the latest orders. */
export const Home = () => {
  const { me, acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(homeStates, harnessEnabled)
  const sample = useMemo(() => homeSample(forced), [forced])
  const seat = useMemo(() => seatOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const latest = useRef(0)

  const load = useCallback(() => {
    // Only the latest request answers: a slow first read never replaces a retry's.
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return setView({ kind: 'ready', ...sample })
    if (seat.supplier) return
    setView({ kind: 'loading' })
    // The locale check is a hint: when its read fails the checklist leaves it out rather than Home failing.
    const localeFacts = seat.owner ? loadLocaleFacts().catch(() => null) : Promise.resolve(null)
    void Promise.all([loadHome(), localeFacts]).then(
      ([home, locale]) => {
        if (mine === latest.current) setView(home ? { kind: 'ready', home, locale } : { kind: 'error' })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, seat.supplier, seat.owner])
  useEffect(load, [load])

  const now = new Date()
  const timeZone = view.kind === 'ready' ? view.home.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone

  if (seat.supplier)
    return (
      <div className="df-home">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState
          title={words.denied.title}
          body={fill(words.denied.body, { store: acting.store.name })}
          action={
            <Link className="df-button" to="/products" search={(prev) => harnessSearch(prev)}>
              {words.denied.action}
            </Link>
          }
        />
      </div>
    )

  return (
    <div className="df-home">
      <div>
        <h1 className="df-page-title">{greetingOf(firstName(me.name), timeZone, now)}</h1>
        <p className="df-page-lede">{dateLineOf(acting.store.name, timeZone, now)}</p>
      </div>
      {seat.readOnly && <p className="df-home-readonly">{words.readOnly}</p>}
      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      {view.kind === 'ready' && <HomeBody home={view.home} locale={view.locale} seat={seat} />}
    </div>
  )
}

const HomeBody = ({ home, locale, seat }: { home: StoreHome; locale: StoreLocaleFacts | null; seat: HomeSeat }) => {
  const tasks = tasksOf(home)
  const setup = setupOf(home, seat.owner ? locale : null)
  const numbers = numbersOf(home)
  return (
    <>
      {tasks.length > 0 && (
        <section className="df-home-section" aria-labelledby="df-home-needs">
          <h2 id="df-home-needs" className="df-home-eyebrow df-home-eyebrow--brand">
            {words.needsYou}
          </h2>
          <ul className="df-home-tasks">
            {tasks.map((task) => (
              <li key={task.kind}>
                <TaskLink task={task} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {tasks.length === 0 && home.hasOrders && (
        <p className="df-home-clear" role="status">
          <strong>{words.allClear.title}</strong> {words.allClear.body}
        </p>
      )}
      {setup.length > 0 && <Checklist items={setup} owner={seat.owner} />}
      {!home.hasOrders && setup.length === 0 && (
        <section className="df-home-card df-home-wait" aria-labelledby="df-home-wait">
          <h2 id="df-home-wait">{words.staffWait.title}</h2>
          <p>{words.staffWait.body}</p>
        </section>
      )}
      {home.hasOrders && (
        <section className="df-home-section" aria-labelledby="df-home-numbers">
          <h2 id="df-home-numbers" className="df-home-eyebrow">
            {home.sales ? words.numbers.title : words.numbers.titleToday}
          </h2>
          <ul className="df-home-numbers">
            {numbers.map((card) => (
              <li key={card.key}>
                <NumberLink card={card} reports={seat.reports} />
              </li>
            ))}
          </ul>
          <LatestOrders orders={home.latestOrders} />
        </section>
      )}
    </>
  )
}

const TaskBody = ({ task, cta }: { task: Task; cta: string }) => (
  <>
    <span className="df-home-task-count">{formatCount(task.count)}</span>
    <span className="df-home-task-text">
      <strong>{task.title}</strong>
      {task.body && <span>{task.body}</span>}
    </span>
    <span className="df-home-task-cta" aria-hidden="true">
      {cta} →
    </span>
  </>
)

/** Each task opens its filtered list, as the prototype's do; the payment to collect opens its oldest order. */
const TaskLink = ({ task }: { task: Task }) => {
  const t = words.tasks
  const className = `df-home-task df-home-task--${task.kind}`
  switch (task.kind) {
    case 'toShip':
      return (
        <Link className={className} to="/orders" search={(prev) => ({ ...harnessSearch(prev), filter: 'TO_SHIP' as const })}>
          <TaskBody task={task} cta={t.toShip.cta} />
        </Link>
      )
    case 'collect':
      return task.orderId ? (
        <Link className={className} to="/orders/$orderId" params={{ orderId: task.orderId }} search={(prev) => harnessSearch(prev)}>
          <TaskBody task={task} cta={t.collect.cta} />
        </Link>
      ) : (
        <Link className={className} to="/orders" search={(prev) => ({ ...harnessSearch(prev), filter: 'PAYMENT_PENDING' as const })}>
          <TaskBody task={task} cta={t.collect.cta} />
        </Link>
      )
    case 'approval':
      return (
        <Link className={className} to="/products" search={(prev) => ({ ...harnessSearch(prev), filter: 'pending' as const })}>
          <TaskBody task={task} cta={t.approval.cta} />
        </Link>
      )
    case 'lowStock':
      return (
        <Link className={className} to="/products" search={(prev) => ({ ...harnessSearch(prev), filter: 'low_stock' as const })}>
          <TaskBody task={task} cta={t.lowStock.cta} />
        </Link>
      )
    case 'courier':
      return (
        <Link className={className} to="/settings" search={(prev) => ({ ...harnessSearch(prev), tab: 'shipping' as const })}>
          <TaskBody task={task} cta={t.courier.cta} />
        </Link>
      )
  }
}

const setupLink = (key: SetupItem['key']) => {
  switch (key) {
    case 'locale':
      return { to: '/settings', tab: 'store' } as const
    case 'products':
      return { to: '/products/$productId' } as const
    case 'collections':
      return { to: '/collections' } as const
    case 'payments':
      return { to: '/settings', tab: 'payments' } as const
    case 'shipping':
      return { to: '/settings', tab: 'shipping' } as const
  }
}

const Checklist = ({ items, owner }: { items: SetupItem[]; owner: boolean }) => {
  const s = words.setup
  const done = items.filter((i) => i.done).length
  return (
    <section className="df-home-card df-home-setup" aria-labelledby="df-home-setup">
      <div className="df-home-setup-head">
        <h2 id="df-home-setup">{s.title}</h2>
        <span className="df-home-mono">{fill(s.progress, { done: formatCount(done), total: formatCount(items.length) })}</span>
      </div>
      <div className="df-home-progress" role="progressbar" aria-labelledby="df-home-setup" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
        <span style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <ul className="df-home-steps">
        {items.map((item) => {
          const label = s[item.key].label
          const cta = item.done && item.key !== 'locale' ? s.done : s[item.key].cta
          const body = (
            <>
              <span className="df-home-step-mark" aria-hidden="true">
                {item.done ? s.mark : ''}
              </span>
              <span className="df-home-step-text">
                <span className="df-home-step-label">
                  {label}
                  {item.done && <span className="df-visually-hidden"> {s.doneSuffix}</span>}
                </span>
                {item.note && <span className="df-home-step-note">{item.note}</span>}
              </span>
              <span className="df-home-step-cta">{cta}</span>
            </>
          )
          const link = setupLink(item.key)
          return (
            <li key={item.key} className={item.done ? 'df-home-step df-home-step--done' : 'df-home-step'}>
              {link.to === '/products/$productId' ? (
                <Link to={link.to} params={{ productId: 'new' }} search={(prev) => harnessSearch(prev)}>
                  {body}
                </Link>
              ) : link.to === '/collections' ? (
                <Link to={link.to} search={(prev) => harnessSearch(prev)}>
                  {body}
                </Link>
              ) : (
                <Link to={link.to} search={(prev) => ({ ...harnessSearch(prev), tab: link.tab })}>
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      {!owner && <p className="df-home-step-owner">{s.ownerNote}</p>}
      <p className="df-home-step-foot">{s.footer}</p>
    </section>
  )
}

const NumberBody = ({ card }: { card: NumberCard }) => (
  <>
    <span className="df-home-number-label">{card.label}</span>
    {card.figures.map((figure) => (
      <span key={figure.value} className="df-home-number-figure">
        <span className="df-home-number-value">{figure.value}</span>
        {figure.delta && <span className={`df-home-number-delta df-home-number-delta--${figure.delta.tone}`}>{figure.delta.text}</span>}
      </span>
    ))}
    {card.note && <span className="df-home-number-delta df-home-number-delta--muted">{card.note}</span>}
  </>
)

/** Money opens Reports for a seat that reads it; the counts open their lists. */
const NumberLink = ({ card, reports }: { card: NumberCard; reports: boolean }) => {
  if (card.key === 'orders')
    return (
      <Link className="df-home-number" to="/orders" search={(prev) => harnessSearch(prev)}>
        <NumberBody card={card} />
      </Link>
    )
  if (card.key === 'returning')
    return (
      <Link className="df-home-number" to="/customers" search={(prev) => harnessSearch(prev)}>
        <NumberBody card={card} />
      </Link>
    )
  return reports ? (
    <Link className="df-home-number" to="/reports" search={(prev) => harnessSearch(prev)}>
      <NumberBody card={card} />
    </Link>
  ) : (
    <div className="df-home-number">
      <NumberBody card={card} />
    </div>
  )
}

const LatestOrders = ({ orders }: { orders: HomeOrder[] }) => {
  const o = messages.orders
  return (
    <div className="df-home-card df-home-latest">
      <div className="df-home-latest-head">
        <h3>{words.latest.title}</h3>
        <Link to="/orders" search={(prev) => harnessSearch(prev)}>
          {words.latest.all}
        </Link>
      </div>
      <ul aria-label={words.latest.label}>
        {orders.map((order) => {
          const status = merchantStatus(order.state, order.paymentState, order.fulfilmentState)
          return (
            <li key={order.id}>
              <Link className="df-home-order" to="/orders/$orderId" params={{ orderId: order.id }} search={(prev) => harnessSearch(prev)}>
                <span className="df-home-mono">{order.number}</span>
                <span className="df-home-order-who">
                  {order.customerName ?? o.row.guest}
                  {order.test && <span className="df-home-order-test">{fill(words.latest.test, { test: o.row.test })}</span>}
                </span>
                <span className={`df-home-order-status df-home-order-status--${statusTone[status]}`}>{o.status[status]}</span>
                <span className="df-home-order-total">{order.total ? moneyText(order.total) : fill(plural(o.row.items, order.items), { count: formatCount(order.items) })}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
