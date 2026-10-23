import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, fakeClient, hasText, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'
import { resetScenario } from '../states/scenario'
import { bannersFor } from './bannerSpecs'
import { Banners } from './Banners'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

const mockSession: { client: ApiClient | null } = { client: null }

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ sessionClient: () => mockSession.client, session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>

const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}
const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressablesNamed(renderer, label).at(-1) as ReactTestInstance)
  await settle()
}
const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))

beforeEach(() => {
  jest.clearAllMocks()
  resetScenario()
})

const now = new Date('2026-10-13T09:00:00Z')
const asking = (note: string | null = 'Ticket #4821: product photos look blurry') => ({
  readOnly: false,
  status: 'active',
  trialEndsAt: null,
  pastDueSince: null,
  provisioning: null,
  support: { partnerName: 'Northstar', agentFirstName: 'Asha', endsAt: '2026-10-13T09:25:00Z', sessionId: 'session-1', access: 'read', writeRequest: { state: 'pending', note } },
})

// The shell's own reads, counted so a test can see the banner asked the state again after an answer.
const shellClient = (state: unknown): { client: ApiClient; stateReads: () => number } => {
  const inner = fakeClient({ state })
  let reads = 0
  return {
    client: { request: (query, variables) => ((reads += query.includes('storeState') ? 1 : 0), inner.request(query, variables)) },
    stateReads: () => reads,
  }
}

const show = async (permissions: string[], handlers: Handlers = {}, role = 'owner', state: unknown = asking()) => {
  const { client, calls } = fakeApi({ 'acting { permissions': () => ({ me: { acting: { permissions, seller: null } } }), ...handlers })
  mockSession.client = client
  const shell = shellClient(state)
  const banners = bannersFor({ seat: { side: 'merchant', role: role as 'owner' }, state: state as Parameters<typeof bannersFor>[0]['state'], support: null, online: true, scenario: 'real', now })
  const renderer = await renderShell(<Banners banners={banners} />, { acting: actingAs(role), client: shell.client })
  await settle()
  return { renderer, calls, stateReads: shell.stateReads }
}

const allowWrite = ['support.allow_write']

describe('support asking to make changes (the elevation banner)', () => {
  it('shows the request with its note, and Allow and Deny, to a seat that may answer', async () => {
    const { renderer } = await show(allowWrite)

    expect(hasText(renderer, 'Northstar support (Asha) is viewing your store.')).toBe(true)
    expect(hasText(renderer, 'Asha from Northstar support is asking to make changes for this session: “Ticket #4821: product photos look blurry”')).toBe(true)
    expect(pressablesNamed(renderer, 'Allow')).toHaveLength(1)
    expect(pressablesNamed(renderer, 'Deny')).toHaveLength(1)
  })

  it('asks without a note when the agent gave none', async () => {
    const { renderer } = await show(allowWrite, {}, 'owner', asking(null))

    expect(hasText(renderer, 'Asha from Northstar support is asking to make changes for this session.')).toBe(true)
  })

  it('shows a Manager the buttons too, and a seat without support.allow_write none, though it sees the banner', async () => {
    const manager = await show(allowWrite, {}, 'manager')
    expect(pressablesNamed(manager.renderer, 'Allow')).toHaveLength(1)

    const staff = await show([], {}, 'staff')
    expect(hasText(staff.renderer, 'Northstar support (Asha) is viewing your store.')).toBe(true)
    expect(pressablesNamed(staff.renderer, 'Allow')).toHaveLength(0)
    expect(pressablesNamed(staff.renderer, 'Deny')).toHaveLength(0)
  })

  it('shows no buttons once the request is answered, or when there was none', async () => {
    const answered = { ...asking(), support: { ...asking().support, access: 'write', writeRequest: { state: 'allowed', note: null } } }
    const done = await show(allowWrite, {}, 'owner', answered)
    expect(hasText(done.renderer, 'Changes allowed. Ends in 25 min.')).toBe(true)
    expect(pressablesNamed(done.renderer, 'Allow')).toHaveLength(0)

    const none = await show(allowWrite, {}, 'owner', { ...asking(), support: { ...asking().support, writeRequest: null } })
    expect(hasText(none.renderer, 'Read-only. Ends in 25 min.')).toBe(true)
    expect(pressablesNamed(none.renderer, 'Allow')).toHaveLength(0)
  })

  it('allows only after saying what that lets support do, for this one session', async () => {
    const { renderer, calls, stateReads } = await show(allowWrite, { 'mutation AnswerSupport': () => ({ allowSupportWrite: true }) })
    const before = stateReads()

    await click(renderer, 'Allow')
    expect(hasText(renderer, 'Let Asha make changes?')).toBe(true)
    expect(hasText(renderer, 'for this one session only')).toBe(true)
    expect(hasText(renderer, 'They still can’t change passwords, payment details, payouts or who works here.')).toBe(true)
    expect(hasText(renderer, 'Everything they do is in your Activity log under their name')).toBe(true)
    expect(asked(calls, 'AnswerSupport')).toHaveLength(0)
    await clickLast(renderer, 'Allow changes')

    expect(asked(calls, 'allowSupportWrite')[0]?.variables).toEqual({ id: 'session-1' })
    expect(hasText(renderer, 'Asha can make changes until this session ends.')).toBe(true)
    expect(stateReads()).toBeGreaterThan(before)
  })

  it('denies only after saying support stays read-only and can ask again', async () => {
    const { renderer, calls } = await show(allowWrite, { 'mutation AnswerSupport': () => ({ denySupportWrite: true }) })

    await click(renderer, 'Deny')
    expect(hasText(renderer, 'Deny Asha’s request?')).toBe(true)
    expect(hasText(renderer, 'Asha stays read-only for the rest of this session, and can ask again.')).toBe(true)
    expect(asked(calls, 'AnswerSupport')).toHaveLength(0)
    await clickLast(renderer, 'Deny')

    expect(asked(calls, 'denySupportWrite')[0]?.variables).toEqual({ id: 'session-1' })
    expect(hasText(renderer, 'Asha stays read-only.')).toBe(true)
  })

  it('says a request that is no longer open is no longer open, and keeps the sheet', async () => {
    const { renderer } = await show(allowWrite, { 'mutation AnswerSupport': () => { throw new ApiError('NOT_PENDING', 'x') } })

    await click(renderer, 'Allow')
    await clickLast(renderer, 'Allow changes')

    expect(hasText(renderer, 'That request is no longer open.')).toBe(true)
  })

  it('says by its code when the seat may not answer', async () => {
    const { renderer } = await show(allowWrite, { 'mutation AnswerSupport': () => { throw new ApiError('FORBIDDEN', 'x') } })

    await click(renderer, 'Deny')
    await clickLast(renderer, 'Deny')

    expect(hasText(renderer, 'Only the store owner or a manager can answer this.')).toBe(true)
  })
})
