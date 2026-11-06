// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ issue: vi.fn() }))
vi.mock('../../api/support', async (actual) => ({ ...(await actual<typeof import('../../api/support')>()), issueSupportWriteCode: api.issue }))
vi.mock('../../api/shell', async (actual) => ({ ...(await actual<typeof import('../../api/shell')>()), loadSupportBanner: () => new Promise(() => undefined) }))

const { SupportBanner } = await import('./SupportBanner')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the write code in the banner', () => {
  it('shows the code once given, and takes it away the second it expires', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const start = new Date('2026-11-06T10:00:00Z')
    vi.setSystemTime(start)
    api.issue.mockResolvedValue({ code: '482913', expiresAt: new Date(start.getTime() + 5_000).toISOString() })
    const support = { partnerName: 'Northstar', agentFirstName: 'Priya', endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(), sessionId: 's1', access: 'read' as const, allowedBy: null, writeRequest: null, extendable: null }
    const { container } = render(<SupportBanner support={support} now={start} inSupport={false} canDecide manager={false} storeName="Kesari Threads" />)

    fireEvent.click(screen.getByRole('button', { name: 'Give support a code' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Get a code', hidden: true }))
      await Promise.resolve()
    })
    expect(container.querySelector('.df-strip')?.textContent).toContain('482913')

    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(container.querySelector('.df-strip')?.textContent).not.toContain('482913')
  })
})
