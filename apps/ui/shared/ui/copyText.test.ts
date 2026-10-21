// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './copyText'

afterEach(() => vi.restoreAllMocks())

describe('copyText', () => {
  it('answers true once the text is on the clipboard', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    expect(await copyText('abc')).toBe(true)
    expect(write).toHaveBeenCalledWith('abc')
  })

  it('answers false when the browser refuses, rather than throwing', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    expect(await copyText('abc')).toBe(false)
  })
})
