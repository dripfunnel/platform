import { EmptyState, ErrorState, firstName, LoadingState, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { loadHome, loadLocaleFacts, skipSetupStep, type HomeOrder, type SkippableStep, type StoreHome, type StoreLocaleFacts } from '../../api/home'
import { chooseShopCategory, loadShopCategory, type ShopCategoryChoice } from '../../api/shopCategory'
import { BrandStep } from './BrandStep'
import { harnessEnabled, harnessSearch } from '../../harness'
import { SampleCatalogAction } from '../common/SampleCatalogAction'
import { fill, formatCount, messages, plural } from '../../messages'
import { merchantStatus, moneyText } from '../orders/orderView'
import { homeSample, homeStates, type HomeState } from './homeStates'
import { dateLineOf, greetingOf, numbersOf, setupCount, setupOf, tasksOf, type NumberCard, type SetupItem, type Task } from './homeView'
import './home.css'

const words = messages.home
const shellRoute = getRouteApi('/_app')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; home: StoreHome; locale: StoreLocaleFacts | null; category?: ShopCategoryChoice | null }

interface HomeSeat {
  supplier: boolean
  /** The checklist's country, currency and language are the Owner's (`settings`). */
  owner: boolean
  reports: boolean
  /** May import products (`catalog.import`): the products step's Import and sample catalog. */
  importer: boolean
  readOnly: boolean
}

const seatOf = (forced: HomeState | null, acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean): HomeSeat => {
  if (forced === 'denied') return { supplier: true, owner: false, reports: false, importer: false, readOnly: false }
  if (forced === 'manager' || forced === 'newManager') return { supplier: false, owner: false, reports: true, importer: true, readOnly: false }
  if (forced === 'staff' || forced === 'newStaff') return { supplier: false, owner: false, reports: false, importer: false, readOnly: false }
  if (forced) return { supplier: false, owner: true, reports: true, importer: true, readOnly: forced === 'readOnly' }
  const has = (p: string) => acting.permissions.includes(p)
  return { supplier: acting.seller !== null, owner: has('settings'), reports: has('reports.read'), importer: has('catalog.import'), readOnly }
}

const statusTone = { toShip: 'brand', partly: 'warning', shipped: 'success', refunded: 'muted', cancelled: 'muted' } as const

/** Home (PortalHome, FIRST-RELEASE §5): what needs the seat, the checklist for a new store, the numbers and the latest orders. */
export const Home = () => {
  const { me, acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(homeStates, harnessEnabled)
  const sample = useMemo(() => homeSample(forced), [forced])
  const seat = useMemo(() => seatOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [skipFailed, setSkipFailed] = useState(false)
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
    const category = seat.owner ? loadShopCategory().catch(() => null) : Promise.resolve(null)
    void Promise.all([loadHome(), localeFacts, category]).then(
      ([home, locale, choice]) => {
        if (mine === latest.current) setView(home ? { kind: 'ready', home, locale, category: choice } : { kind: 'error' })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, seat.supplier, seat.owner])
  useEffect(load, [load])

  const skip = (step: SkippableStep, skipped: boolean) => {
    setSkipFailed(false)
    void (sample ? Promise.resolve() : skipSetupStep(step, skipped)).then(
      () =>
        setView((v) => (v.kind === 'ready' && v.home.setup ? { ...v, home: { ...v.home, setup: { ...v.home.setup, [`${step}Skipped`]: skipped } } } : v)),
      () => setSkipFailed(true),
    )
  }

  const choose = async (id: string) => {
    const chosen = sample ? null : await chooseShopCategory(id)
    setView((v) =>
      v.kind === 'ready' && v.home.setup
        ? { ...v, home: { ...v.home, setup: { ...v.home.setup, category: true } }, category: v.category ? { ...v.category, current: chosen ?? v.category.options.find((o) => o.id === id) ?? null } : null }
        : v,
    )
  }

  // A logo makes the step done; it stays open on this visit so the favicon can follow.
  const [brandOpen, setBrandOpen] = useState(false)
  const logoAdded = () => {
    setBrandOpen(true)
    setView((v) => (v.kind === 'ready' && v.home.setup ? { ...v, home: { ...v.home, setup: { ...v.home.setup, brand: true, brandSkipped: false } } } : v))
  }

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
      {view.kind === 'ready' && <HomeBody home={view.home} locale={view.locale} category={view.category ?? null} seat={seat} onSkip={skip} onChoose={choose} skipFailed={skipFailed} brand={{ open: brandOpen, shopName: acting.store.name, onLogo: logoAdded }} />}
    </div>
  )
}

interface HomeBodyProps {
  home: StoreHome
  locale: StoreLocaleFacts | null
  category: ShopCategoryChoice | null
  seat: HomeSeat
  onSkip: (step: SkippableStep, skipped: boolean) => void
  onChoose: (id: string) => Promise<void>
  skipFailed: boolean
  brand: BrandStepState
}

interface BrandStepState {
  open: boolean
  shopName: string
  onLogo: () => void
}

const HomeBody = ({ home, locale, category, seat, onSkip, onChoose, skipFailed, brand }: HomeBodyProps) => {
  const tasks = tasksOf(home)
  const setup = setupOf(home, seat.owner ? locale : null, category?.current?.name ?? null)
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
      {setup.length > 0 && <Checklist items={setup} owner={seat.owner} onSkip={seat.readOnly ? null : onSkip} skipFailed={skipFailed} categories={category?.options ?? []} onChoose={seat.readOnly ? null : onChoose} sample={category?.current?.hasSample === true} importer={seat.importer && !seat.readOnly} brand={seat.readOnly ? null : brand} />}
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
    case 'category':
      return { to: '/settings', tab: 'catalogue' } as const
    case 'products':
      return { to: '/products/$productId' } as const
    case 'collections':
      return { to: '/collections' } as const
    case 'payments':
      return { to: '/settings', tab: 'payments' } as const
    case 'shipping':
      return { to: '/settings', tab: 'shipping' } as const
    case 'brand':
      return { to: '/storefront', tab: 'settings' } as const
  }
}

interface ChecklistProps {
  items: SetupItem[]
  owner: boolean
  onSkip: ((step: SkippableStep, skipped: boolean) => void) | null
  skipFailed: boolean
  categories: ShopCategoryChoice['options']
  /** Null for a read-only session: the step then opens Settings, as the others do. */
  onChoose: ((id: string) => Promise<void>) | null
  /** The chosen category has a sample catalog staff made (CATALOG-DESIGN A4). */
  sample: boolean
  importer: boolean
  /** Null for a read-only session: the step then opens Site settings. */
  brand: BrandStepState | null
}

const Checklist = ({ items, owner, onSkip, skipFailed, categories, onChoose, sample, importer, brand }: ChecklistProps) => {
  // Once the Owner said what the shop sells, the products step offers a way in: sample, import or by hand.
  const categoryChosen = items.some((i) => i.key === 'category' && i.done)
  const s = words.setup
  const { done, total } = setupCount(items)
  return (
    <section className="df-home-card df-home-setup" aria-labelledby="df-home-setup">
      <div className="df-home-setup-head">
        <h2 id="df-home-setup">{s.title}</h2>
        <span className="df-home-mono">{fill(s.progress, { done: formatCount(done), total: formatCount(total) })}</span>
      </div>
      <div className="df-home-progress" role="progressbar" aria-labelledby="df-home-setup" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <span style={{ width: `${total === 0 ? 100 : (done / total) * 100}%` }} />
      </div>
      <ul className="df-home-steps">
        {items.map((item) => {
          const label = s[item.key].label
          const cta = item.skipped ? null : item.key === 'category' && item.done ? s.category.change : item.done && item.key !== 'locale' ? s.done : s[item.key].cta
          const body = (
            <>
              <span className="df-home-step-mark" aria-hidden="true">
                {item.done ? s.mark : item.skipped ? s.skippedMark : ''}
              </span>
              <span className="df-home-step-text">
                <span className="df-home-step-label">
                  {label}
                  {item.done && <span className="df-visually-hidden"> {s.doneSuffix}</span>}
                  {(item.skipped || item.optional) && <span className="df-home-step-tag">{item.skipped ? s.skipped : s.optional}</span>}
                </span>
                {item.note && <span className="df-home-step-note">{item.note}</span>}
              </span>
              {cta && <span className="df-home-step-cta">{cta}</span>}
            </>
          )
          const link = setupLink(item.key)
          if (item.key === 'products' && !item.done && categoryChosen)
            return (
              <li key={item.key} className="df-home-step df-home-step--choices">
                <ProductsStep label={label} sample={sample && importer} importer={importer} />
              </li>
            )
          if (item.key === 'brand' && brand && !item.skipped && (!item.done || brand.open))
            return (
              <li key={item.key} className="df-home-step df-home-step--choices">
                <BrandStep label={label} done={item.done} shopName={brand.shopName} onLogo={brand.onLogo} />
                {onSkip && !item.done && (
                  <button type="button" className="df-button df-home-step-skip" aria-label={fill(s.skipFor, { step: label })} onClick={() => onSkip('brand', true)}>
                    {s.skip}
                  </button>
                )}
              </li>
            )
          if (item.key === 'category' && !item.done && onChoose && categories.length > 0)
            return (
              <li key={item.key} className="df-home-step">
                <CategoryStep label={label} categories={categories} onChoose={onChoose} />
              </li>
            )
          return (
            <li key={item.key} className={`df-home-step${item.done ? ' df-home-step--done' : ''}${item.skipped ? ' df-home-step--skipped' : ''}`}>
              {link.to === '/products/$productId' ? (
                <Link to={link.to} params={{ productId: 'new' }} search={(prev) => harnessSearch(prev)}>
                  {body}
                </Link>
              ) : link.to === '/collections' ? (
                <Link to={link.to} search={(prev) => harnessSearch(prev)}>
                  {body}
                </Link>
              ) : link.to === '/storefront' ? (
                <Link to={link.to} search={(prev) => ({ ...harnessSearch(prev), tab: link.tab })}>
                  {body}
                </Link>
              ) : (
                <Link to={link.to} search={(prev) => ({ ...harnessSearch(prev), tab: link.tab })}>
                  {body}
                </Link>
              )}
              {onSkip && (item.optional || item.skipped) && (
                <button type="button" className="df-button df-home-step-skip" aria-label={fill(item.skipped ? s.undoFor : s.skipFor, { step: label })} onClick={() => onSkip(item.key as SkippableStep, !item.skipped)}>
                  {item.skipped ? s.undo : s.skip}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {skipFailed && (
        <p className="df-home-step-owner" role="alert">
          {s.skipError}
        </p>
      )}
      {!owner && <p className="df-home-step-owner">{s.ownerNote}</p>}
      <p className="df-home-step-foot">{s.footer}</p>
    </section>
  )
}

/** The products step after the category is chosen: the sample catalog, an import, or "Add 3 products and 1 collection". */
const ProductsStep = ({ label, sample, importer }: { label: string; sample: boolean; importer: boolean }) => {
  const s = words.setup.products
  const [manual, setManual] = useState(false)
  return (
    <div className="df-home-step-choices">
      <span className="df-home-step-mark" aria-hidden="true" />
      <span className="df-home-step-text">
        <span className="df-home-step-label">{label}</span>
        {manual && (
          <span className="df-home-step-note">
            {s.manualNote}{' '}
            <Link to="/products/$productId" params={{ productId: 'new' }} search={(prev) => harnessSearch(prev)}>
              {s.cta}
            </Link>
          </span>
        )}
      </span>
      <span className="df-home-step-actions">
        {sample && <SampleCatalogAction />}
        {importer && (
          <Link to="/products/import" className="df-button" search={(prev) => harnessSearch(prev)}>
            {s.import}
          </Link>
        )}
        <button type="button" className="df-button" aria-expanded={manual} onClick={() => setManual((m) => !m)}>
          {s.manual}
        </button>
      </span>
    </div>
  )
}

/** The Owner picks what the shop sells right on the checklist; the sections it suggests are offered in Settings › Catalogue. */
const CategoryStep = ({ label, categories, onChoose }: { label: string; categories: ShopCategoryChoice['options']; onChoose: (id: string) => Promise<void> }) => {
  const s = words.setup.category
  const id = useId()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const save = () => {
    setBusy(true)
    setFailed(false)
    onChoose(picked).then(
      () => setOpen(false),
      () => (setFailed(true), setBusy(false)),
    )
  }
  if (!open)
    return (
      <button type="button" className="df-home-step-pick" onClick={() => setOpen(true)}>
        <span className="df-home-step-mark" aria-hidden="true" />
        <span className="df-home-step-text">
          <span className="df-home-step-label">{label}</span>
        </span>
        <span className="df-home-step-cta" aria-hidden="true">
          {s.cta}
        </span>
      </button>
    )
  return (
    <form
      className="df-home-step-picker"
      onSubmit={(e) => {
        e.preventDefault()
        if (picked) save()
      }}
    >
      <label htmlFor={`${id}-category`}>{s.picker}</label>
      <select id={`${id}-category`} value={picked} disabled={busy} onChange={(e) => setPicked(e.target.value)} autoFocus>
        <option value="" disabled>
          {s.placeholder}
        </option>
        {categories
          .filter((c) => !c.archived)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
      <button type="submit" className="df-button df-button--primary" disabled={!picked || busy}>
        {s.save}
      </button>
      <button type="button" className="df-button" disabled={busy} onClick={() => setOpen(false)}>
        {s.cancel}
      </button>
      {failed && (
        <p className="df-home-step-owner" role="alert">
          {s.error}
        </p>
      )}
    </form>
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
