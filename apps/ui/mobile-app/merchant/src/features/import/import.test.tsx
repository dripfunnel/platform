import { act } from 'react-test-renderer'
import { AppState, Linking } from 'react-native'
import { type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell, texts } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { ImportScreen } from './ImportScreen'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockNavigate = jest.fn()
const mockSession: { client: ApiClient | null } = { client: null }
const mockPick = jest.fn()
const mockRead = jest.fn()
const mockShare = jest.fn()

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), navigate: mockNavigate, back: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('./files', () => ({ pickCsv: (...args: unknown[]) => mockPick(...args), readCsv: (...args: unknown[]) => mockRead(...args) }))
jest.mock('../common/shareCsv', () => ({ shareCsv: (...args: unknown[]) => mockShare(...args) }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The fake network answers over several promise turns; wait on promises, and move a timer by hand where the screen polls.
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}
const tick = async (ms: number) => {
  await act(async () => void jest.advanceTimersByTime(ms))
  await settle()
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const pageInfo = { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }
const access = (permissions: string[], seller: { id: string } | null = null) => ({ me: { acting: { permissions, seller } } })
const importer = ['catalog.read', 'catalog.write', 'catalog.import', 'stock.write']
const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

const problem = (over: Record<string, unknown> = {}) => ({ line: 3, column: 'price', code: 'INVALID_PRICE', message: 'The price isn’t a number.', ...over })
const importJob = (over: Record<string, unknown> = {}) => ({
  id: 'imp-1',
  state: 'ready',
  source: 'csv',
  products: 10,
  ready: 8,
  matched: 2,
  done: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
  photosPending: 0,
  problemCount: 3,
  problems: [problem(), problem({ line: 7, column: null, code: 'NO_NAME', message: 'This row has no name.' })],
  problemsCsv: 'row,problem\n3,price',
  ...over,
})
const exportJob = (over: Record<string, unknown> = {}) => ({ id: 'e-1', kind: 'products', state: 'done', requestedAt: '2026-10-16T08:00:00Z', rows: 120, truncated: false, csv: 'name\nShirt', expiresAt: null, ...over })

const base: Handlers = {
  'acting { permissions': () => access(importer),
  'warehouses(first': () => ({ warehouses: { nodes: [{ id: 'w-1', name: 'Main shop', isDefault: true, supplierId: null }], pageInfo } }),
  catalogImports: () => ({ catalogImports: [] }),
  catalogExports: () => ({ catalogExports: [] }),
}

const show = async (handlers: Handlers, options: Parameters<typeof renderShell>[1] & { supplier?: string } = {}) => {
  const { client, calls } = fakeApi({ ...base, ...handlers }, { supplier: options.supplier ?? null })
  mockSession.client = client
  const renderer = await renderShell(<ImportScreen />, options)
  await settle()
  return { renderer, calls }
}

const withTimers = (body: () => Promise<void>) => async () => {
  jest.useFakeTimers()
  try {
    await body()
  } finally {
    jest.useRealTimers()
  }
}

const picked = { uri: 'file:///cache/spring.csv', name: 'spring.csv', size: 2048, mimeType: 'text/csv' }
const chooseFile = 'Import from a spreadsheet. Choose a file'

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
  mockShare.mockResolvedValue(true)
})

describe('importing a CSV picked from the phone', () => {
  it(
    'sends the file’s text as it is, shows the check, and follows the run to its end with the failed rows',
    withTimers(async () => {
      const csv = 'Title,Price\nShirt,499\n'
      mockPick.mockResolvedValue(picked)
      mockRead.mockResolvedValue(csv)
      const answers = [importJob(), importJob({ state: 'running', done: 3 }), importJob({ state: 'done', done: 8, created: 6, updated: 2, failed: 2, problemCount: 2 })]
      const { renderer, calls } = await show({
        startCatalogImport: () => ({ startCatalogImport: 'imp-1' }),
        'catalogImport(id': () => ({ catalogImport: answers.length > 1 ? answers.shift() : answers[0] }),
        confirmCatalogImport: () => ({ confirmCatalogImport: true }),
      })

      await press(pressableNamed(renderer, chooseFile))
      await settle()
      expect(calls.find((call: Call) => call.query.includes('startCatalogImport'))?.variables).toEqual({ file: csv })
      expect(texts(renderer)).toEqual(expect.arrayContaining(['8 ready', 'Row 3 · price', 'The price isn’t a number.', 'Row 7 · the file', 'This row has no name.']))
      expect(hasText(renderer, '2 with problems')).toBe(true)
      expect(hasText(renderer, '1 more is in the file.')).toBe(true)
      expect(hasText(renderer, 'Main shop (default)')).toBe(true)

      await press(pressableNamed(renderer, 'Import 8 products'))
      await settle()
      expect(calls.find((call: Call) => call.query.includes('confirmCatalogImport'))?.variables).toEqual({ id: 'imp-1', matching: 'update', warehouse: 'w-1' })
      expect(hasText(renderer, 'Importing 8 products')).toBe(true)

      await tick(2000)
      expect(hasText(renderer, '3 of 8 done.')).toBe(true)

      await tick(2000)
      expect(hasText(renderer, '6 added · 2 updated')).toBe(true)
      expect(hasText(renderer, '2 products couldn’t be saved.')).toBe(true)
      expect(hasText(renderer, 'What didn’t go in')).toBe(true)
      expect(hasText(renderer, 'The price isn’t a number.')).toBe(true)

      await press(pressableNamed(renderer, 'Share what didn’t go in'))
      expect(mockShare).toHaveBeenCalledWith('What didn’t go in', 'row,problem\n3,price')
    }),
  )

  it(
    'imports only the new products, into the location chosen, when asked to skip those already there',
    withTimers(async () => {
      mockPick.mockResolvedValue(picked)
      mockRead.mockResolvedValue('Title\nShirt\n')
      const { renderer, calls } = await show({
        'warehouses(first': () => ({
          warehouses: {
            nodes: [
              { id: 'w-1', name: 'Main shop', isDefault: true, supplierId: null },
              { id: 'w-2', name: 'Pop-up', isDefault: false, supplierId: null },
              { id: 'w-9', name: 'Northwind’s', isDefault: false, supplierId: 'supplier-9' },
            ],
            pageInfo,
          },
        }),
        startCatalogImport: () => ({ startCatalogImport: 'imp-1' }),
        'catalogImport(id': () => ({ catalogImport: importJob() }),
        confirmCatalogImport: () => ({ confirmCatalogImport: true }),
      })

      await press(pressableNamed(renderer, chooseFile))
      await settle()
      expect(hasText(renderer, 'Northwind’s')).toBe(false)
      await press(pressableNamed(renderer, 'Skip them, only add new ones'))
      await press(pressableNamed(renderer, 'Pop-up'))
      expect(hasText(renderer, 'Import 6 products')).toBe(true)
      await press(pressableNamed(renderer, 'Import 6 products'))
      await settle()

      expect(calls.find((call: Call) => call.query.includes('confirmCatalogImport'))?.variables).toEqual({ id: 'imp-1', matching: 'skip', warehouse: 'w-2' })
    }),
  )

  it(
    'follows the check while the API reads the file, then shows it',
    withTimers(async () => {
      mockPick.mockResolvedValue(picked)
      mockRead.mockResolvedValue('Title\nShirt\n')
      const answers = [importJob({ state: 'checking' }), importJob()]
      const { renderer } = await show({
        startCatalogImport: () => ({ startCatalogImport: 'imp-1' }),
        'catalogImport(id': () => ({ catalogImport: answers.length > 1 ? answers.shift() : answers[0] }),
      })

      await press(pressableNamed(renderer, chooseFile))
      await settle()
      expect(hasText(renderer, 'Checking your file…')).toBe(true)
      await tick(2000)
      expect(hasText(renderer, 'Checking your file…')).toBe(false)
      expect(hasText(renderer, '8 ready')).toBe(true)
    }),
  )

  it('says why a file is refused on the phone, and sends nothing', async () => {
    const { renderer, calls } = await show({})

    mockPick.mockResolvedValue({ ...picked, name: 'stock.xlsx', mimeType: 'application/vnd.ms-excel' })
    await press(pressableNamed(renderer, chooseFile))
    await settle()
    expect(hasText(renderer, 'That file type can’t be imported')).toBe(true)
    expect(hasText(renderer, 'stock.xlsx isn’t a CSV file. Save it as CSV')).toBe(true)

    mockPick.mockResolvedValue({ ...picked, name: 'all.csv', size: 6 * 1024 * 1024 })
    await press(pressableNamed(renderer, 'Choose another file'))
    await settle()
    expect(hasText(renderer, 'That file is too big')).toBe(true)
    expect(hasText(renderer, 'all.csv is 6 MB; the limit is 5 MB.')).toBe(true)

    expect(calls.some((call: Call) => call.query.includes('startCatalogImport'))).toBe(false)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('says so when the API finds no name column, and offers to choose another file', async () => {
    mockPick.mockResolvedValue(picked)
    mockRead.mockResolvedValue('A,B\n1,2\n')
    const { renderer } = await show({
      startCatalogImport: () => ({ startCatalogImport: 'imp-1' }),
      'catalogImport(id': () => ({ catalogImport: importJob({ state: 'unreadable', problems: [problem({ line: 0, column: null, code: 'NO_NAME_COLUMN', message: 'x' })] }) }),
    })

    await press(pressableNamed(renderer, chooseFile))
    await settle()
    expect(hasText(renderer, 'Some columns we need are missing')).toBe(true)
    expect(hasText(renderer, 'spring.csv has no “name” or “handle” column.')).toBe(true)
    expect(pressablesNamed(renderer, 'Choose another file')).toHaveLength(1)
  })

  it('words a refusal of the start by its code, never by the API’s words', async () => {
    mockPick.mockResolvedValue(picked)
    mockRead.mockResolvedValue('Title\nShirt\n')
    const { ApiError } = jest.requireActual('../../graphql') as typeof import('../../graphql')
    const { renderer } = await show({
      startCatalogImport: () => {
        throw new ApiError('FILE_TOO_LARGE', 'internal detail 4f2a')
      },
    })

    await press(pressableNamed(renderer, chooseFile))
    await settle()
    expect(hasText(renderer, 'A file can be up to 5 MB. Split it and import each part.')).toBe(true)
    expect(hasText(renderer, 'internal detail')).toBe(false)
  })

  it('says when the picked file cannot be read, and sends nothing', async () => {
    mockPick.mockResolvedValue(picked)
    mockRead.mockRejectedValue(new Error('gone'))
    const { renderer, calls } = await show({})

    await press(pressableNamed(renderer, chooseFile))
    await settle()
    expect(hasText(renderer, 'That file couldn’t be read')).toBe(true)
    expect(hasText(renderer, 'spring.csv didn’t open.')).toBe(true)
    expect(calls.some((call: Call) => call.query.includes('startCatalogImport'))).toBe(false)
  })

  it('does nothing when the person backs out of the picker', async () => {
    mockPick.mockResolvedValue(null)
    const { renderer, calls } = await show({})

    await press(pressableNamed(renderer, chooseFile))
    await settle()
    expect(calls.some((call: Call) => call.query.includes('startCatalogImport'))).toBe(false)
    expect(hasText(renderer, 'Choose a file')).toBe(true)
  })
})

describe('a run in progress, done or stopped', () => {
  it(
    'is found again when the screen opens, and followed to its end',
    withTimers(async () => {
      const answers = [importJob({ state: 'running', done: 5 }), importJob({ state: 'done', done: 8, created: 8, problems: [], problemCount: 0, problemsCsv: null })]
      const { renderer } = await show({
        catalogImports: () => ({ catalogImports: [importJob({ state: 'running', done: 2 })] }),
        'catalogImport(id': () => ({ catalogImport: answers.length > 1 ? answers.shift() : answers[0] }),
      })

      expect(hasText(renderer, 'Importing 8 products')).toBe(true)
      expect(hasText(renderer, '2 of 8 done.')).toBe(true)
      await press(pressableNamed(renderer, 'Go to Products while it runs'))
      expect(mockNavigate).toHaveBeenCalledWith('/catalogue')

      await tick(2000)
      expect(hasText(renderer, '5 of 8 done.')).toBe(true)
      await tick(2000)
      expect(hasText(renderer, '8 added · 0 updated')).toBe(true)
      expect(hasText(renderer, 'What didn’t go in')).toBe(false)
      expect(pressablesNamed(renderer, 'Share what didn’t go in')).toHaveLength(0)
      await press(pressableNamed(renderer, 'See your products'))
      expect(mockNavigate).toHaveBeenLastCalledWith('/catalogue')
    }),
  )

  it(
    'says the import stopped, with the reason the API gives for the whole run',
    withTimers(async () => {
      const { renderer } = await show({
        catalogImports: () => ({ catalogImports: [importJob({ state: 'running', done: 2 })] }),
        'catalogImport(id': () => ({ catalogImport: importJob({ state: 'failed', problems: [problem({ line: 0, column: null, code: 'SHOPIFY_LOST', message: 'Shopify stopped letting us in.' })] }) }),
      })

      await tick(2000)
      expect(hasText(renderer, 'The import stopped')).toBe(true)
      expect(hasText(renderer, 'Shopify stopped letting us in.')).toBe(true)
      await press(pressableNamed(renderer, 'Start again'))
      expect(hasText(renderer, 'Import from a spreadsheet')).toBe(true)
    }),
  )
})

describe('Shopify', () => {
  const typeShop = async (renderer: Awaited<ReturnType<typeof show>>['renderer'], value: string) => {
    const field = renderer.root.findAll((node) => node.props.accessibilityLabel === 'Your Shopify store address' && typeof node.props.onChangeText === 'function')[0]
    await act(async () => field?.props.onChangeText(value))
  }
  const listeners: Array<(state: string) => void> = []

  beforeEach(() => {
    listeners.length = 0
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
      listeners.push(listener)
      return { remove: jest.fn() }
    }) as never)
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
  })
  afterEach(() => jest.restoreAllMocks())

  const shopProducts = { shopifyProducts: { nodes: [{ id: 'sp-1', title: 'Mara Shirt', status: 'ACTIVE', versions: 3, imageUrl: null }, { id: 'sp-2', title: 'Old Tote', status: 'ARCHIVED', versions: 1, imageUrl: null }], next: null } }

  it('opens Shopify in the browser for the shop typed, and the picker opens once the app finds it connected', async () => {
    let connection = { available: true, status: 'none', shop: null as string | null }
    const { renderer, calls } = await show({
      shopifyConnection: () => ({ shopifyConnection: connection }),
      connectShopify: () => ({ connectShopify: 'https://juniper.myshopify.com/admin/oauth/authorize?x=1' }),
      shopifyProducts: () => shopProducts,
    })

    await press(pressableNamed(renderer, 'Bring products from Shopify. Connect Shopify'))
    await settle()
    await typeShop(renderer, 'juniper')
    await press(pressableNamed(renderer, 'Connect'))
    await settle()
    expect(calls.find((call: Call) => call.query.includes('connectShopify'))?.variables).toEqual({ shop: 'juniper.myshopify.com' })
    expect(Linking.openURL).toHaveBeenCalledWith('https://juniper.myshopify.com/admin/oauth/authorize?x=1')
    expect(hasText(renderer, 'Waiting for Shopify.')).toBe(true)

    // Back in the app before the approval finished: told so, nothing opens.
    await act(async () => listeners.forEach((listener) => listener('active')))
    await settle()
    expect(hasText(renderer, 'Shopify isn’t connected yet.')).toBe(true)

    connection = { available: true, status: 'connected', shop: 'juniper.myshopify.com' }
    await act(async () => listeners.forEach((listener) => listener('active')))
    await settle()
    expect(hasText(renderer, 'Connected to juniper.myshopify.com · pick products')).toBe(true)
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Mara Shirt', 'Old Tote']))
    expect(hasText(renderer, 'Archived · 1 version')).toBe(true)
  })

  it('never opens an address that is not https', async () => {
    const { renderer } = await show({
      shopifyConnection: () => ({ shopifyConnection: { available: true, status: 'none', shop: null } }),
      connectShopify: () => ({ connectShopify: 'http://juniper.myshopify.com/admin' }),
    })

    await press(pressableNamed(renderer, 'Bring products from Shopify. Connect Shopify'))
    await settle()
    await typeShop(renderer, 'juniper')
    await press(pressableNamed(renderer, 'Connect'))
    await settle()
    expect(Linking.openURL).not.toHaveBeenCalled()
  })

  it('says when connecting Shopify is not set up, and when the connection expired', async () => {
    const { renderer } = await show({ shopifyConnection: () => ({ shopifyConnection: { available: false, status: 'none', shop: null } }) })
    await press(pressableNamed(renderer, 'Bring products from Shopify. Connect Shopify'))
    await settle()
    expect(hasText(renderer, 'Connecting Shopify isn’t set up here.')).toBe(true)

    const expired = await show({ shopifyConnection: () => ({ shopifyConnection: { available: true, status: 'expired', shop: 'juniper.myshopify.com' } }) })
    await press(pressableNamed(expired.renderer, 'Bring products from Shopify. Connect Shopify'))
    await settle()
    expect(hasText(expired.renderer, 'the connection expired')).toBe(true)
    expect(pressablesNamed(expired.renderer, 'Connect again')).toHaveLength(1)
  })

  it('checks the picked products by id, or every product after Select all', async () => {
    const { renderer, calls } = await show({
      shopifyConnection: () => ({ shopifyConnection: { available: true, status: 'connected', shop: 'juniper.myshopify.com' } }),
      shopifyProducts: () => shopProducts,
      startShopifyImport: () => ({ startShopifyImport: 'imp-3' }),
      'catalogImport(id': () => ({ catalogImport: importJob({ source: 'shopify' }) }),
    })

    await press(pressableNamed(renderer, 'Bring products from Shopify. Connect Shopify'))
    await settle()
    // The first page opens ticked; untick one.
    await press(pressableNamed(renderer, 'Old Tote'))
    await press(pressableNamed(renderer, 'Check 1 product'))
    await settle()
    expect(calls.find((call: Call) => call.query.includes('startShopifyImport'))?.variables).toEqual({ ids: ['sp-1'] })
    expect(hasText(renderer, '8 ready')).toBe(true)

    await press(pressableNamed(renderer, 'Choose a fixed file'))
    await press(pressableNamed(renderer, 'Bring products from Shopify. Connect Shopify'))
    await settle()
    await press(pressableNamed(renderer, 'Select all'))
    await press(pressableNamed(renderer, 'Check all products'))
    await settle()
    expect(calls.filter((call: Call) => call.query.includes('startShopifyImport')).at(-1)?.variables).toEqual({ all: true })
  })
})

describe('exporting products and stock', () => {
  it(
    'asks for a job, follows it while it is prepared, and opens the share sheet once it is ready',
    withTimers(async () => {
      const reads = [exportJob({ state: 'queued', csv: null, rows: null }), exportJob({ state: 'done' })]
      const { renderer, calls } = await show({
        requestCatalogExport: () => ({ requestCatalogExport: 'e-1' }),
        'catalogExport(id': () => ({ catalogExport: reads.length > 1 ? reads.shift() : reads[0] }),
      })

      await press(pressableNamed(renderer, 'Export products'))
      await settle()
      expect(calls.find((call: Call) => call.query.includes('requestCatalogExport'))?.variables).toEqual({ kind: 'products' })
      expect(hasText(renderer, 'Preparing your file…')).toBe(true)
      expect(mockShare).not.toHaveBeenCalled()

      await tick(1500)
      expect(hasText(renderer, 'Preparing your file…')).toBe(false)
      expect(mockShare).toHaveBeenCalledWith('Products', 'name\nShirt')
    }),
  )

  it('says the export could not be made when the job was too large', async () => {
    const { renderer } = await show({
      requestCatalogExport: () => ({ requestCatalogExport: 'e-1' }),
      'catalogExport(id': () => ({ catalogExport: exportJob({ state: 'too_large', csv: null, rows: null }) }),
    })

    await press(pressableNamed(renderer, 'Export products'))
    await settle()
    expect(hasText(renderer, 'The export couldn’t be made. Try again.')).toBe(true)
    expect(mockShare).not.toHaveBeenCalled()
  })

  it('asks for a stock export too', async () => {
    const { renderer, calls } = await show({ requestCatalogExport: () => ({ requestCatalogExport: 'e-2' }) })

    await press(pressableNamed(renderer, 'Export stock'))
    await settle()
    expect(calls.find((call: Call) => call.query.includes('requestCatalogExport'))?.variables).toEqual({ kind: 'stock' })
  })

  it('lists recent files with what each came to: expired, too large, couldn’t be made, cut short', async () => {
    const { renderer } = await show({
      catalogExports: () => ({
        catalogExports: [
          exportJob({ id: 'e-1', state: 'expired', csv: null }),
          exportJob({ id: 'e-2', kind: 'stock', state: 'too_large', csv: null }),
          exportJob({ id: 'e-3', state: 'failed', csv: null }),
          exportJob({ id: 'e-4', truncated: true, rows: 5000 }),
        ],
      }),
    })

    expect(texts(renderer)).toEqual(expect.arrayContaining(['Expired', 'Too large', 'Couldn’t be made']))
    expect(hasText(renderer, 'Only the first 5,000 rows are in it.')).toBe(true)
    expect(pressablesNamed(renderer, 'Share')).toHaveLength(1)
  })

  it('says so when the file could not be shared', async () => {
    mockShare.mockRejectedValue(new Error('no app'))
    const { renderer } = await show({ catalogExports: () => ({ catalogExports: [exportJob()] }) })

    await press(pressableNamed(renderer, 'Share'))
    expect(hasText(renderer, 'The file couldn’t be shared. Try again.')).toBe(true)
  })

  it('shares a recent file again, titled by its kind', async () => {
    const { renderer } = await show({ catalogExports: () => ({ catalogExports: [exportJob({ kind: 'stock' })] }) })

    await press(pressableNamed(renderer, 'Share'))
    expect(mockShare).toHaveBeenCalledWith('Stock', 'name\nShirt')
  })
})

describe('who sees what', () => {
  it('lets a supplier import and export through its own seat, with the supplier header on every call', async () => {
    const { renderer, calls } = await show(
      { 'acting { permissions': () => access(['catalog.read', 'catalog.write', 'catalog.import', 'stock.write'], { id: 'supplier-1' }), catalogExports: () => ({ catalogExports: [exportJob()] }) },
      { acting: actingAs('supplier-member', 'vendor-catalogue'), supplier: 'supplier-1' },
    )

    expect(hasText(renderer, 'Import & export')).toBe(true)
    expect(pressablesNamed(renderer, chooseFile)).toHaveLength(1)
    expect(pressablesNamed(renderer, 'Share')).toHaveLength(1)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call: Call) => call.headers['x-supplier'] === 'supplier-1')).toBe(true)
    await press(pressableNamed(renderer, 'Share'))
    expect(mockShare).toHaveBeenCalled()
  })

  it('leaves a Staff seat with Export only', async () => {
    const { renderer } = await show({ 'acting { permissions': () => access(['catalog.read']) }, { acting: actingAs('staff') })

    expect(hasText(renderer, 'Export')).toBe(true)
    expect(pressablesNamed(renderer, chooseFile)).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Export products')).toHaveLength(1)
    expect(hasText(renderer, 'Bring products in from a spreadsheet')).toBe(false)
  })

  it('is access denied for a Stock-only supplier', async () => {
    const { renderer } = await show(
      { 'acting { permissions': () => access(['catalog.read', 'stock.write', 'catalog.propose'], { id: 'supplier-1' }) },
      { acting: actingAs('supplier-member', 'vendor-stock'), supplier: 'supplier-1' },
    )

    expect(hasText(renderer, 'You don’t have access to Import & export')).toBe(true)
    expect(pressablesNamed(renderer, chooseFile)).toHaveLength(0)
    expect(pressablesNamed(renderer, 'Export products')).toHaveLength(0)
  })

  it('is access denied for a seat with no catalogue access', async () => {
    const { renderer } = await show({ 'acting { permissions': () => access([]) })

    expect(hasText(renderer, 'You don’t have access to Import & export')).toBe(true)
  })

  it('draws the load failure when the permissions cannot be read', async () => {
    const { renderer } = await show({
      'acting { permissions': () => {
        throw new Error('down')
      },
    })

    expect(hasText(renderer, 'We couldn’t load Import & export')).toBe(true)
  })

  it('stops imports while the store is read-only, and still exports', async () => {
    const { renderer } = await show({ catalogExports: () => ({ catalogExports: [exportJob()] }) }, { client: fakeClient({ state: readOnlyState }) })

    expect(hasText(renderer, 'Your store is read-only until the bill is paid, so nothing can be imported. Exports still work.')).toBe(true)
    expect(pressableNamed(renderer, chooseFile).props.accessibilityState.disabled).toBe(true)
    expect(pressableNamed(renderer, 'Export products').props.disabled).toBe(false)
    await press(pressableNamed(renderer, 'Share'))
    expect(mockShare).toHaveBeenCalled()
  })
})
