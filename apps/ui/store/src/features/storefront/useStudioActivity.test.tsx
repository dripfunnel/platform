// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StorefrontApi } from './storefrontApi'
import { useStudioActivity, wakeStudio } from './useStudioActivity'

// storefront AI-STUDIO §7 "Stopping" (#1241): the wake is at most every 30 s for the portal, never from a hidden tab.
const portal = () => ({ studioActivity: vi.fn().mockResolvedValue(undefined) }) as unknown as StorefrontApi & { studioActivity: ReturnType<typeof vi.fn> }
const shown = (state: 'visible' | 'hidden') => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })

afterEach(() => {
  shown('visible')
  vi.useRealTimers()
})

describe('waking the studio', () => {
  it('sends nothing from a hidden tab', () => {
    const api = portal()
    shown('hidden')
    wakeStudio(api)
    expect(api.studioActivity).not.toHaveBeenCalled()
  })

  it('sends one call in 30 seconds, whoever asks: the studio and the gallery share it', () => {
    vi.useFakeTimers()
    const api = portal()
    wakeStudio(api)
    wakeStudio(api)
    expect(api.studioActivity).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    wakeStudio(api)
    expect(api.studioActivity).toHaveBeenCalledTimes(2)
  })

  it('wakes on a click into the frame, and not while the studio is closed', () => {
    vi.useFakeTimers()
    const api = portal()
    const frame = document.body.appendChild(document.createElement('iframe'))
    const { rerender } = renderHook(({ open }) => useStudioActivity(api, open), { initialProps: { open: false } })
    const clickIntoFrame = () => {
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(frame)
      act(() => {
        window.dispatchEvent(new Event('blur'))
        vi.advanceTimersByTime(0)
      })
    }
    clickIntoFrame()
    expect(api.studioActivity).not.toHaveBeenCalled()
    rerender({ open: true })
    clickIntoFrame()
    expect(api.studioActivity).toHaveBeenCalledTimes(1)
    frame.remove()
  })
})
