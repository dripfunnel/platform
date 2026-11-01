import { ApiError, type FieldError } from '@dripfunnel/shared/graphql'
import { isRedirect } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { actingStore, rememberActing } from '../../acting'
import type { PageOf } from '../../api/allPages'
import type { Acting, Me, StoreChoice } from '../../api/shell'

const api = vi.hoisted(() => ({ readShell: vi.fn(), shellSample: vi.fn() }))

vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), readShell: api.readShell }))
vi.mock('../../api/sample', async (actual) => ({ ...(await actual<typeof import('../../api/sample')>()), shellSample: api.shellSample }))

const { loadShell } = await import('./loadShell')

const acting: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: [] }
const me = (held: Acting | null): Me => ({ id: 'u1', name: 'Farhan', email: 'farhan@example.com', acting: held })
const choice = (id: string): StoreChoice => ({ membershipId: `m-${id}`, store: { id, name: id }, role: 'owner', tier: null, seller: null })
const onePage: PageOf<StoreChoice> = { nodes: [choice('s1')], pageInfo: { hasNextPage: false, endCursor: null } }

interface Fields {
  me?: Me | null
  myStores?: PageOf<StoreChoice> | null
  storeState?: null
  navBadges?: { products: number | null; toShip: number | null } | null
}

// The one shell answer: each field's data, and the fields refused by code.
const answer = (fields: Fields, refused: Record<string, string> = {}) => {
  const errors: FieldError[] = Object.entries(refused).map(([field, code]) => ({ path: [field], error: new ApiError(code, `${field} refused`) }))
  api.readShell.mockResolvedValue({ data: { me: null, myStores: null, storeState: null, navBadges: null, ...fields }, errors })
}

// Where loadShell sent the person, or the error it let through.
const outcome = async () => {
  try {
    return { data: await loadShell({}, '/orders?status=open') }
  } catch (error) {
    if (isRedirect(error)) return { to: error.options.to, search: error.options.search }
    return { error }
  }
}

const toChooser = { to: '/stores', search: { next: '/orders?status=open' } }

describe('loadShell', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.shellSample.mockReturnValue(null)
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) })
    rememberActing({ storeId: 's1', supplierId: null })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads the shell in one request', async () => {
    answer({ me: me(acting), myStores: onePage })
    await outcome()
    expect(api.readShell).toHaveBeenCalledOnce()
  })

  it('sends someone signed out to sign-in, coming back to the same page, whatever the other fields answer', async () => {
    answer({}, { myStores: 'UNAUTHENTICATED', storeState: 'UNAUTHENTICATED', navBadges: 'UNAUTHENTICATED' })
    expect(await outcome()).toEqual({ to: '/sign-in', search: { next: '/orders?status=open' } })
  })

  it('forgets a remembered store the person no longer holds and asks again, ignoring the store’s refused reads', async () => {
    answer({ me: me(null), myStores: onePage }, { storeState: 'FORBIDDEN', navBadges: 'FORBIDDEN' })
    expect(await outcome()).toEqual(toChooser)
    expect(actingStore()).toBeNull()
    expect(localStorage.getItem('df-store-acting')).toBeNull()
  })

  it('asks again for a role or tier this release doesn’t know', async () => {
    answer({ me: me({ ...acting, role: 'chief' }), myStores: onePage })
    expect(await outcome()).toEqual(toChooser)
  })

  it('forgets the store and asks again when the store’s state answers FORBIDDEN', async () => {
    answer({ me: me(acting), myStores: onePage }, { storeState: 'FORBIDDEN' })
    expect(await outcome()).toEqual(toChooser)
    expect(actingStore()).toBeNull()
  })

  it('forgets the store and asks again when the store list answers FORBIDDEN', async () => {
    answer({ me: me(acting) }, { myStores: 'FORBIDDEN' })
    expect(await outcome()).toEqual(toChooser)
    expect(actingStore()).toBeNull()
  })

  it('lets any other refusal of the store’s reads through to the error screen, keeping the store', async () => {
    answer({ me: me(acting), myStores: onePage }, { storeState: 'STORE_SUSPENDED' })
    expect(await outcome()).toMatchObject({ error: { code: 'STORE_SUSPENDED' } })
    answer({ me: me(acting) }, { myStores: 'BLOCKED_FOR_SUPPORT' })
    expect(await outcome()).toMatchObject({ error: { code: 'BLOCKED_FOR_SUPPORT' } })
    expect(actingStore()).toEqual({ storeId: 's1', supplierId: null })
  })

  it('lets a request that never answered through to the error screen, keeping the store', async () => {
    const down = new ApiError('NOT_CONNECTED', 'offline')
    api.readShell.mockRejectedValue(down)
    expect(await outcome()).toEqual({ error: down })
    expect(actingStore()).toEqual({ storeId: 's1', supplierId: null })
  })

  it('lets a refused me through to the error screen', async () => {
    answer({}, { me: 'INTERNAL_SERVER_ERROR' })
    expect(await outcome()).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR' } })
  })

  it('opens the shell in the acting store', async () => {
    answer({ me: me(acting), myStores: onePage, navBadges: { products: 2, toShip: null } })
    expect(await outcome()).toMatchObject({ data: { acting, seat: { side: 'merchant', role: 'owner' }, stores: [choice('s1')], state: null, badges: { ordersToShip: 0, productsToApprove: 2 } } })
  })

  it('draws no badge when its count is refused, and still opens the shell', async () => {
    answer({ me: me(acting), myStores: onePage }, { navBadges: 'NOT_CONNECTED' })
    expect(await outcome()).toMatchObject({ data: { badges: { ordersToShip: 0, productsToApprove: 0 } } })
  })

  it('pages through every store past the first fifty, after the one request', async () => {
    const seen: (string | null)[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seen.push((JSON.parse(String(init.body)) as { variables: { after: string | null } }).variables.after)
      return new Response(JSON.stringify({ data: { myStores: { nodes: [choice('c')], pageInfo: { hasNextPage: false, endCursor: 'c2' } } } }))
    })
    answer({ me: me(acting), myStores: { nodes: [choice('a'), choice('b')], pageInfo: { hasNextPage: true, endCursor: 'c1' } } })
    const result = await outcome()
    expect(result).toMatchObject({ data: { stores: [choice('a'), choice('b'), choice('c')] } })
    expect(seen).toEqual(['c1'])
  })

  it('forgets the store when a later page of stores answers FORBIDDEN', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: null, errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] })))
    answer({ me: me(acting), myStores: { nodes: [choice('a')], pageInfo: { hasNextPage: true, endCursor: 'c1' } } })
    expect(await outcome()).toEqual(toChooser)
    expect(actingStore()).toBeNull()
  })

  it('opens the harness’s sample shell with no request at all', async () => {
    api.shellSample.mockReturnValue({ me: me(acting), stores: [choice('s1')], state: null, badges: { ordersToShip: 3, productsToApprove: 2 } })
    expect(await outcome()).toMatchObject({ data: { acting, badges: { ordersToShip: 3 } } })
    expect(api.readShell).not.toHaveBeenCalled()
  })
})
