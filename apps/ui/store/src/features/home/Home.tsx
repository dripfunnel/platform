import { EmptyState, ErrorState, firstName, LoadingState, pollWhileVisible, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { loadHome, loadLocaleFacts, type HomeOrder, type StoreHome, type StoreLocaleFacts } from '../../api/home'
import { chooseShopCategory, loadShopCategory, type ShopCategoryChoice } from '../../api/shopCategory'
import { chooseTemplate, loadOverview, loadTemplates } from '../../api/storefront'
import { startingTemplate } from '../storefront/overviewView'
import { BrandStep } from './BrandStep'
import { StorefrontStep } from './StorefrontStep'
import { SearchSelect } from '../common/SearchSelect'
import { harnessEnabled, harnessSearch } from '../../harness'
import { SampleCatalogAction } from '../common/SampleCatalogAction'
import { fill, formatCount, messages, plural } from '../../messages'
import { merchantStatus, moneyText } from '../orders/orderView'
import { homeSample, homeStates, type HomeState } from './homeStates'
import { dateLineOf, greetingOf, numbersOf, setupCount, setupOf, storefrontPhaseOf, tasksOf, type NumberCard, type SetupItem, type StorefrontSetup, type Task } from './homeView'
import './home.css'

const words = messages.home
const shellRoute = getRouteApi('/_app')
const creatingPollMs = 5_000

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; home: StoreHome; locale: StoreLocaleFacts | null; category?: ShopCategoryChoice | null; storefront?: StorefrontSetup | null }

interface HomeSeat {
  supplier: boolean
  /** The checklist's country, currency and language are the Owner's (`settings`). */
  owner: boolean
  reports: boolean
  /** May import products (`catalog.import`): the products step's Import and sample catalog. */
  importer: boolean
  /** May make the store's site (`storefront.read` and `publish`): the storefront step. */
  site: boolean
  readOnly: boolean
}

const seatOf = (forced: HomeState | null, acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean): HomeSeat => {
  if (forced === 'denied') return { supplier: true, owner: false, reports: false, importer: false, site: false, readOnly: false }
  if (forced === 'manager' || forced === 'newManager') return { supplier: false, owner: false, reports: true, importer: true, site: false, readOnly: false }
  if (forced === 'staff' || forced === 'newStaff') return { supplier: false, owner: false, reports: false, importer: false, site: false, readOnly: false }
  if (forced) return { supplier: false, owner: true, reports: true, importer: true, site: true, readOnly: forced === 'readOnly' }
  const has = (p: string) => acting.permissions.includes(p)
  return { supplier: acting.seller !== null, owner: has('settings'), reports: has('reports.read'), importer: has('catalog.import'), site: has('storefront.read') && has('publish'), readOnly }
}

const loadStorefrontSetup = async (): Promise<StorefrontSetup> => {
  const [overview, templates] = await Promise.all([loadOverview(), loadTemplates()])
  return { status: overview.status, published: overview.live !== null, template: startingTemplate(templates) }
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
  const navigate = useNavigate()

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
      async ([home, locale, choice]) => {
        if (mine !== latest.current) return
        if (!home) return setView({ kind: 'error' })
        // The storefront step lives in the checklist, so the site is read only while the checklist can show.
        const site = seat.site && home.setup && !home.hasOrders ? await loadStorefrontSetup().catch(() => null) : null
        if (mine === latest.current) setView({ kind: 'ready', home, locale, category: choice, storefront: site })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, seat.supplier, seat.owner, seat.site])
  useEffect(load, [load])

  const setSite = useCallback((change: Partial<StorefrontSetup>) => setView((v) => (v.kind === 'ready' && v.storefront ? { ...v, storefront: { ...v.storefront, ...change } } : v)), [])

  // While the site is being made, its status is read again until it is ready, as on the Storefront page.
  const creating = view.kind === 'ready' && view.storefront?.status === 'creating' && !sample
  useEffect(() => {
    if (!creating) return
    let asked = 0
    return pollWhileVisible(
      () => {
        const ask = ++asked
        loadOverview().then(
          (overview) => ask === asked && setSite({ status: overview.status, published: overview.live !== null }),
          () => undefined,
        )
      },
      creatingPollMs,
      { doc: document, win: window },
    )
  }, [creating, setSite])

  const createSite = async () => {
    const template = view.kind === 'ready' ? view.storefront?.template : null
    if (!template) return void navigate({ to: '/storefront', search: (prev) => harnessSearch(prev) })
    setSite({ status: sample ? 'creating' : await chooseTemplate(template.key, true) })
  }

  const choose = async (id: string) => {
    const chosen = sample ? null : await chooseShopCategory(id)
    setView((v) =>
      v.kind === 'ready' && v.home.setup
        ? { ...v, home: { ...v.home, setup: { ...v.home.setup, category: true } }, category: v.category ? { ...v.category, current: chosen ?? v.category.options.find((o) => o.id === id) ?? null } : null }
        : v,
    )
  }

  const brandAdded = useCallback(() => setView((v) => (v.kind === 'ready' && v.home.setup ? { ...v, home: { ...v.home, setup: { ...v.home.setup, brand: true } } } : v)), [])

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
      {view.kind === 'ready' && (
        <HomeBody home={view.home} locale={view.locale} category={view.category ?? null} storefront={view.storefront ?? null} seat={seat} onChoose={choose} brand={{ shopName: acting.store.name, onDone: brandAdded }} onCreateSite={createSite} />
      )}
    </div>
  )
}

interface HomeBodyProps {
  home: StoreHome
  locale: StoreLocaleFacts | null
  category: ShopCategoryChoice | null
  storefront: StorefrontSetup | null
  seat: HomeSeat
  onChoose: (id: string) => Promise<void>
  brand: BrandStepState
  onCreateSite: () => Promise<void>
}

interface BrandStepState {
  shopName: string
  onDone: () => void
}

const HomeBody = ({ home, locale, category, storefront, seat, onChoose, brand, onCreateSite }: HomeBodyProps) => {
  const tasks = tasksOf(home)
  const setup = setupOf(home, seat.owner ? locale : null, category?.current?.name ?? null, storefront)
  // The first site needs what the shop sells (its template) and the logo and favicon (BRAND_NOT_READY).
  const site = storefront && { setup: storefront, phase: storefrontPhaseOf(storefront, home.setup?.category === true && home.setup.brand === true), onCreate: onCreateSite }
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
      {setup.length > 0 && (
        <Checklist
          items={setup}
          owner={seat.owner}
          categories={category?.options ?? []}
          onChoose={seat.readOnly ? null : onChoose}
          sample={category?.current?.hasSample === true}
          importer={seat.importer && !seat.readOnly}
          brand={seat.readOnly ? null : brand}
          site={seat.readOnly ? null : site}
        />
      )}
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
    case 'brand':
      return { to: '/storefront', tab: 'settings' } as const
    case 'storefront':
      return { to: '/storefront', tab: 'design' } as const
  }
}

interface SiteStepState {
  setup: StorefrontSetup
  phase: ReturnType<typeof storefrontPhaseOf>
  onCreate: () => Promise<void>
}

interface ChecklistProps {
  items: SetupItem[]
  owner: boolean
  categories: ShopCategoryChoice['options']
  /** Null for a read-only session: the step then opens Settings, as the others do. */
  onChoose: ((id: string) => Promise<void>) | null
  /** The chosen category has a sample catalog staff made (CATALOG-DESIGN A4). */
  sample: boolean
  importer: boolean
  /** Null for a read-only session: the step then opens Site settings. */
  brand: BrandStepState | null
  /** Null for a read-only session: the step then opens Storefront. */
  site: SiteStepState | null
}

const Checklist = ({ items, owner, categories, onChoose, sample, importer, brand, site }: ChecklistProps) => {
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
          const cta = item.key === 'category' && item.done ? s.category.change : item.done && item.key !== 'locale' ? s.done : s[item.key].cta
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
          if (item.key === 'brand' && brand && !item.done)
            return (
              <li key={item.key} className="df-home-step df-home-step--choices">
                <BrandStep label={label} shopName={brand.shopName} onDone={brand.onDone} />
              </li>
            )
          if (item.key === 'storefront' && site && site.phase !== 'done')
            return (
              <li key={item.key} className="df-home-step df-home-step--choices">
                <StorefrontStep label={label} site={site.setup} phase={site.phase} onCreate={site.onCreate} />
              </li>
            )
          if (item.key === 'category' && !item.done && onChoose && categories.length > 0)
            return (
              <li key={item.key} className="df-home-step">
                <CategoryStep label={label} categories={categories} onChoose={onChoose} />
              </li>
            )
          return (
            <li key={item.key} className={`df-home-step${item.done ? ' df-home-step--done' : ''}`}>
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
            </li>
          )
        })}
      </ul>
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
      <span id={`${id}-category`} className="df-home-step-picker-label">
        {s.picker}
      </span>
      <SearchSelect
        labelledBy={`${id}-category`}
        options={categories.filter((c) => !c.archived).map((c) => ({ id: c.id, label: c.name }))}
        value={picked || null}
        onChange={setPicked}
        placeholder={s.placeholder}
        noMatches={s.noMatches}
        disabled={busy}
        autoFocus
      />
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
