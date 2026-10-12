// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishRun } from '../../api/studio'
import { publishPollMs, publishReadTries } from './studioRules'
import { usePublishRun } from './usePublishRun'

// The one poller behind the studio and the Publish now bar (#683).

const runOf = (step: PublishRun['step'], id = 'r1'): PublishRun => ({ id, step, version: 13, repairAttempts: 0, checks: [], bisectMessageId: null })
const tick = (ms = publishPollMs) => act(async () => void vi.advanceTimersByTime(ms))

const follow = (loadPublishRun: (id: string) => Promise<PublishRun | null>, run: string | null = 'r1') => {
  const api = { loadPublishRun: vi.fn(loadPublishRun) }
  const onProgress = vi.fn()
  const onEnd = vi.fn()
  const onReadError = vi.fn()
  const hook = renderHook(({ id, restart }: { id: string | null; restart: number }) => usePublishRun(api, id, { onProgress, onEnd, onReadError, restart }), { initialProps: { id: run, restart: 0 } })
  return { api, onProgress, onEnd, onReadError, hook }
}

describe('usePublishRun', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('reads nothing while no publish is followed', async () => {
    const { api } = follow(() => Promise.resolve(runOf('queued')), null)
    await tick()
    expect(api.loadPublishRun).not.toHaveBeenCalled()
  })

  it('reads the publish every publishPollMs while it runs, then stops once it ends', async () => {
    const answers = [runOf('queued'), runOf('checking'), runOf('going_live'), runOf('live')]
    const { api, onProgress, onEnd } = follow(() => Promise.resolve(answers.shift() ?? runOf('live')))
    await tick(0)
    expect(onProgress).toHaveBeenLastCalledWith(runOf('queued'))
    await tick()
    expect(onProgress).toHaveBeenLastCalledWith(runOf('checking'))
    await tick()
    expect(onProgress).toHaveBeenLastCalledWith(runOf('going_live'))
    expect(onEnd).not.toHaveBeenCalled()
    await tick()
    expect(onEnd).toHaveBeenCalledWith(runOf('live'))
    expect(onProgress).toHaveBeenCalledTimes(3)
    await tick(publishPollMs * 3)
    expect(api.loadPublishRun).toHaveBeenCalledTimes(4)
    expect(api.loadPublishRun).toHaveBeenCalledWith('r1')
  })

  it('ends with null when there is no such publish', async () => {
    const { api, onEnd } = follow(() => Promise.resolve(null))
    await tick(0)
    expect(onEnd).toHaveBeenCalledWith(null)
    await tick(publishPollMs * 2)
    expect(api.loadPublishRun).toHaveBeenCalledTimes(1)
  })

  it('drops a late answer for a publish no longer followed', async () => {
    let answerFirst: (run: PublishRun) => void = () => undefined
    const { onProgress, onEnd, hook } = follow((id) => (id === 'r1' ? new Promise((resolve) => (answerFirst = resolve)) : Promise.resolve(runOf('live', id))))
    hook.rerender({ id: 'r2', restart: 0 })
    await tick(0)
    expect(onEnd).toHaveBeenCalledWith(runOf('live', 'r2'))
    await act(async () => answerFirst(runOf('failed')))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('keeps asking through a few failures, then stops and says it lost the publish until Check again', async () => {
    const read = vi.fn<(id: string) => Promise<PublishRun | null>>().mockRejectedValue(new Error('offline'))
    const { api, onEnd, onReadError, hook } = follow(read)
    await tick(0)
    for (let i = 1; i < publishReadTries; i += 1) await tick()
    expect(hook.result.current.lost).toBe(true)
    expect(onReadError).toHaveBeenCalledTimes(publishReadTries)
    await tick(publishPollMs * 3)
    expect(api.loadPublishRun).toHaveBeenCalledTimes(publishReadTries)
    expect(onEnd).not.toHaveBeenCalled()

    read.mockResolvedValue(runOf('live'))
    act(() => hook.result.current.checkAgain())
    expect(hook.result.current.lost).toBe(false)
    await tick(0)
    expect(onEnd).toHaveBeenCalledWith(runOf('live'))
  })

  it('counts only failures in a row', async () => {
    const read = vi.fn<(id: string) => Promise<PublishRun | null>>()
    for (let i = 1; i < publishReadTries; i += 1) read.mockRejectedValueOnce(new Error('offline'))
    read.mockResolvedValueOnce(runOf('checking'))
    for (let i = 1; i < publishReadTries; i += 1) read.mockRejectedValueOnce(new Error('offline'))
    read.mockResolvedValue(runOf('live'))
    const { onEnd, hook } = follow(read)
    await tick(0)
    for (let i = 0; i < publishReadTries * 2; i += 1) await tick()
    expect(hook.result.current.lost).toBe(false)
    expect(onEnd).toHaveBeenCalledWith(runOf('live'))
  })

  it.each(['SESSION_ENDED', 'FORBIDDEN'])('stops at once on a refused read (%s)', async (code) => {
    const { api, onReadError, hook } = follow(() => Promise.reject(new ApiError(code, 'No.')))
    await tick(0)
    expect(hook.result.current.lost).toBe(true)
    expect(onReadError).toHaveBeenCalledWith(expect.objectContaining({ code }))
    await tick(publishPollMs * 3)
    expect(api.loadPublishRun).toHaveBeenCalledTimes(1)
  })

  it('starts over when its restart value changes', async () => {
    const { api, hook } = follow(() => Promise.resolve(runOf('failed')))
    await tick(0)
    hook.rerender({ id: 'r1', restart: 1 })
    await tick(0)
    expect(api.loadPublishRun).toHaveBeenCalledTimes(2)
  })
})
