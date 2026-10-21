import { ApiError } from '@dripfunnel/shared/graphql'
import { isRedirect } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { actingStore, rememberActing } from '../../acting'
import type { Acting, Me } from '../../api/shell'

const api = vi.hoisted(() => ({ loadMe: vi.fn(), loadMyStores: vi.fn(), loadStoreState: vi.fn(), loadNavBadges: vi.fn() }))

vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), ...api }))

const { loadShell } = await import('./loadShell')

const acting: Acting = { store: { id: 's1', name: 'Kesari Threads' }, role: 'owner', tier: null, seller: null, plan: null, permissions: [] }
const me = (held: Acting | null): Me => ({ id: 'u1', name: 'Farhan', email: 'farhan@example.com', acting: held })

// Where loadShell sent the person, or the error it let through.
const outcome = async () => {
  try {
    return { data: await loadShell({}, '/orders?status=open') }
  } catch (error) {
    if (isRedirect(error)) return { to: error.options.to, search: error.options.search }
    return { error }
  }
}

describe('loadShell', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) })
    rememberActing({ storeId: 's1', supplierId: null })
    api.loadNavBadges.mockResolvedValue({ ordersToShip: 0, productsToApprove: 0 })
  })

  it('sends someone signed out to sign-in, coming back to the same page', async () => {
    api.loadMe.mockResolvedValue(null)
    expect(await outcome()).toEqual({ to: '/sign-in', search: { next: '/orders?status=open' } })
  })

  it('forgets a remembered store the person no longer holds and asks again', async () => {
    api.loadMe.mockResolvedValue(me(null))
    expect(await outcome()).toEqual({ to: '/stores', search: { next: '/orders?status=open' } })
    expect(actingStore()).toBeNull()
    expect(localStorage.getItem('df-store-acting')).toBeNull()
  })

  it('forgets the store and asks again when the store’s reads answer FORBIDDEN', async () => {
    api.loadMe.mockResolvedValue(me(acting))
    api.loadMyStores.mockResolvedValue([])
    api.loadStoreState.mockRejectedValue(new ApiError('FORBIDDEN', 'not yours'))
    expect(await outcome()).toEqual({ to: '/stores', search: { next: '/orders?status=open' } })
    expect(actingStore()).toBeNull()
  })

  it('lets any other failure through to the error screen, keeping the store', async () => {
    const down = new ApiError('NOT_CONNECTED', 'offline')
    api.loadMe.mockResolvedValue(me(acting))
    api.loadMyStores.mockRejectedValue(down)
    api.loadStoreState.mockResolvedValue(null)
    expect(await outcome()).toEqual({ error: down })
    expect(actingStore()).toEqual({ storeId: 's1', supplierId: null })
  })

  it('opens the shell in the acting store', async () => {
    api.loadMe.mockResolvedValue(me(acting))
    api.loadMyStores.mockResolvedValue([])
    api.loadStoreState.mockResolvedValue(null)
    api.loadNavBadges.mockResolvedValue({ ordersToShip: 0, productsToApprove: 2 })
    expect(await outcome()).toMatchObject({ data: { acting, seat: { side: 'merchant', role: 'owner' }, badges: { productsToApprove: 2 } } })
  })

  it('draws no badge when its count fails, and still opens the shell', async () => {
    api.loadMe.mockResolvedValue(me(acting))
    api.loadMyStores.mockResolvedValue([])
    api.loadStoreState.mockResolvedValue(null)
    api.loadNavBadges.mockRejectedValue(new ApiError('NOT_CONNECTED', 'offline'))
    expect(await outcome()).toMatchObject({ data: { badges: { ordersToShip: 0, productsToApprove: 0 } } })
  })
})
