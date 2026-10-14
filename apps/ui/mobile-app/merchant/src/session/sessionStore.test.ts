import { createSessionClient, createSessionStore, type Acting, type SessionStorage } from './sessionStore'

const acting: Acting = { storeId: 'store-1', supplierId: null, storeName: 'Juniper & Co.', role: 'owner', tier: null }

const memoryStorage = (saved: { token: string | null; last: Acting | null } = { token: null, last: null }) => {
  const kept = { ...saved }
  const storage: SessionStorage = {
    read: () => Promise.resolve({ ...kept }),
    writeToken: (token) => Promise.resolve(void (kept.token = token)),
    writeLast: (last) => Promise.resolve(void (kept.last = last)),
    wipe: () => Promise.resolve(void ((kept.token = null), (kept.last = null))),
  }
  return { kept, storage }
}

describe('the session store', () => {
  it('starts, and restores no session when none was saved', async () => {
    const { storage } = memoryStorage()
    const store = createSessionStore(storage)
    expect(store.getState()).toEqual({ status: 'starting' })

    await store.restore()

    expect(store.getState()).toEqual({ status: 'signedOut', notice: null })
    expect(store.token()).toBeNull()
  })

  it('restores a saved session with the last store, but no acting store yet', async () => {
    const store = createSessionStore(memoryStorage({ token: 't0ken', last: acting }).storage)
    await store.restore()
    expect(store.getState()).toEqual({ status: 'signedIn', token: 't0ken', acting: null, last: acting })
  })

  it('keeps the token in secure storage once opened, and the store the person acts in', async () => {
    const { kept, storage } = memoryStorage()
    const store = createSessionStore(storage)
    await store.restore()

    await store.open('t0ken')
    await store.act(acting)

    expect(kept).toEqual({ token: 't0ken', last: acting })
    expect(store.token()).toBe('t0ken')
    expect(store.acting()).toEqual(acting)
  })

  it('goes back to the chooser on Switch store, keeping the session', async () => {
    const store = createSessionStore(memoryStorage().storage)
    await store.open('t0ken')
    await store.act(acting)

    store.leaveStore()

    expect(store.token()).toBe('t0ken')
    expect(store.acting()).toBeNull()
  })

  it('wipes the token and the last store on sign-out, and says why', async () => {
    const { kept, storage } = memoryStorage()
    const store = createSessionStore(storage)
    await store.open('t0ken')
    await store.act(acting)

    await store.end('signedOut')

    expect(kept).toEqual({ token: null, last: null })
    expect(store.getState()).toEqual({ status: 'signedOut', notice: 'signedOut' })
    expect(store.token()).toBeNull()
  })

  it('tells its listeners about every change', async () => {
    const store = createSessionStore(memoryStorage().storage)
    const heard = jest.fn()
    const stop = store.subscribe(heard)

    await store.open('t0ken')
    stop()
    await store.end(null)

    expect(heard).toHaveBeenCalledTimes(1)
  })
})

describe('a signed-in person’s client', () => {
  const answer = (body: unknown) => jest.fn((() => Promise.resolve({ json: () => Promise.resolve(body) })) as unknown as typeof fetch)

  it('carries the session and the acting store and supplier on every call', async () => {
    const store = createSessionStore(memoryStorage().storage)
    await store.open('t0ken')
    await store.act({ ...acting, supplierId: 'supplier-1' })
    const fetchImpl = answer({ data: { ok: true } })

    await createSessionClient(store, { domain: 'store.example.com', fetchImpl }).request('{ ok }')

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(init.headers).toMatchObject({ authorization: 'Bearer t0ken', 'x-store': 'store-1', 'x-supplier': 'supplier-1' })
  })

  it('sends neither the store nor the supplier once the person has switched store', async () => {
    const store = createSessionStore(memoryStorage().storage)
    await store.open('t0ken')
    await store.act({ ...acting, supplierId: 'supplier-1' })
    store.leaveStore()
    const fetchImpl = answer({ data: { ok: true } })

    await createSessionClient(store, { domain: 'store.example.com', fetchImpl }).request('{ ok }')

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }]
    expect(init.headers).toMatchObject({ authorization: 'Bearer t0ken' })
    expect(init.headers).not.toHaveProperty('x-store')
    expect(init.headers).not.toHaveProperty('x-supplier')
  })

  it('ends the session, wiping the token, when the API answers UNAUTHENTICATED', async () => {
    const { kept, storage } = memoryStorage()
    const store = createSessionStore(storage)
    await store.open('t0ken')
    const client = createSessionClient(store, { domain: 'store.example.com', fetchImpl: answer({ errors: [{ message: 'Not signed in.', extensions: { code: 'UNAUTHENTICATED' } }] }) })

    await expect(client.request('{ me }')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    expect(kept.token).toBeNull()
    expect(store.getState()).toEqual({ status: 'signedOut', notice: 'expired' })
  })

  it('keeps the session when the answer is another refusal, or no answer at all', async () => {
    const store = createSessionStore(memoryStorage().storage)
    await store.open('t0ken')
    const refused = createSessionClient(store, { domain: 'store.example.com', fetchImpl: answer({ errors: [{ message: 'No.', extensions: { code: 'FORBIDDEN' } }] }) })
    const offline = createSessionClient(store, { domain: 'store.example.com', fetchImpl: () => Promise.reject(new TypeError('Network request failed')) })

    await expect(refused.request('{ me }')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(offline.request('{ me }')).rejects.toMatchObject({ code: 'NO_RESPONSE' })

    expect(store.token()).toBe('t0ken')
  })
})
