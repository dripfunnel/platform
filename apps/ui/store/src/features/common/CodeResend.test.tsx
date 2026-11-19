// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fill, messages } from '../../messages'
import { afterRefusedSend, CodeResend, resendWaitSeconds, useResendWait } from './CodeResend'

// The one code panel (ACCESS.md §4): where the code went, the 20-second wait, and the two ways to ask again.

const words = messages.codeResend
const both = { whatsapp: true, sms: true }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the code panel', () => {
  it('says the code went to WhatsApp, and offers nothing while the wait runs', () => {
    render(<CodeResend sent={{ channel: 'whatsapp', hint: '•••• 1234' }} channels={both} wait={12} onSend={() => undefined} />)
    expect(screen.getByText(fill(words.sentWhatsapp, { hint: '•••• 1234' }))).toBeTruthy()
    expect(screen.getByText(fill(words.wait, { seconds: '12' }))).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain(words.waiting)
  })

  it('offers Send again on WhatsApp and Send by SMS instead after the wait, and asks by the one chosen', () => {
    const onSend = vi.fn()
    render(<CodeResend sent={{ channel: 'whatsapp', hint: '•••• 1234' }} channels={both} wait={0} onSend={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: words.insteadSms }))
    fireEvent.click(screen.getByRole('button', { name: words.againWhatsapp }))
    expect(onSend.mock.calls).toEqual([['sms'], ['whatsapp']])
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain(words.readyAnnounced)
  })

  it('offers to send a code when none has gone yet', () => {
    render(<CodeResend sent={null} channels={both} wait={0} onSend={() => undefined} />)
    expect(screen.getByRole('button', { name: words.sendWhatsapp })).toBeTruthy()
    expect(screen.getByRole('button', { name: words.sendSms })).toBeTruthy()
    expect(screen.queryByText(words.ready)).toBeNull()
  })

  it('hides the SMS link while SMS is off', () => {
    render(<CodeResend sent={{ channel: 'whatsapp', hint: '•••• 1234' }} channels={{ whatsapp: true, sms: false }} wait={0} onSend={() => undefined} />)
    expect(screen.getByRole('button', { name: words.againWhatsapp })).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.insteadSms })).toBeNull()
  })

  it('says a code went by SMS, and words the links from there', () => {
    render(<CodeResend sent={{ channel: 'sms', hint: '•••• 1234' }} channels={both} wait={0} onSend={() => undefined} />)
    expect(screen.getByText(fill(words.sentSms, { hint: '•••• 1234' }))).toBeTruthy()
    expect(screen.getByRole('button', { name: words.insteadWhatsapp })).toBeTruthy()
    expect(screen.getByRole('button', { name: words.againSms })).toBeTruthy()
  })
})

describe('the wait', () => {
  const Wait = ({ seconds }: { seconds?: number }) => {
    const [wait, start] = useResendWait()
    return (
      <button type="button" onClick={() => start(seconds)}>
        {wait}
      </button>
    )
  }

  it('counts down from 20 seconds, or from the seconds the server asks for', async () => {
    vi.useFakeTimers()
    const view = render(<Wait />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe(String(resendWaitSeconds))
    for (let i = 0; i < resendWaitSeconds; i++) await act(async () => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button').textContent).toBe('0')
    view.unmount()
    render(<Wait seconds={7} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('7')
  })
})

describe('a refused send', () => {
  it('waits the seconds TOO_SOON names', () => {
    expect(afterRefusedSend({ code: 'TOO_SOON', seconds: 9 }, 'sms', both, 'none')).toEqual({ text: fill(words.tooSoon, { seconds: '9' }), wait: 9, channels: both })
  })

  it('closes the channel CHANNEL_OFF refused, and says so while the other is open', () => {
    expect(afterRefusedSend({ code: 'CHANNEL_OFF' }, 'sms', both, 'none')).toEqual({ text: words.off.sms, wait: null, channels: { whatsapp: true, sms: false } })
    expect(afterRefusedSend({ code: 'CHANNEL_OFF' }, 'sms', { whatsapp: false, sms: true }, 'none')).toEqual({ text: 'none', wait: null, channels: { whatsapp: false, sms: false } })
    expect(afterRefusedSend({ code: 'CHANNEL_OFF' }, undefined, both, 'none')).toEqual({ text: 'none', wait: null, channels: { whatsapp: false, sms: false } })
  })

  it('leaves any other refusal to the screen', () => {
    expect(afterRefusedSend({ code: 'RATE_LIMITED' }, 'sms', both, 'none')).toBeNull()
  })
})
