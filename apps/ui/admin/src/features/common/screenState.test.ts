import { describe, expect, it } from 'vitest'
import { isHarnessEnabled, parseScreenState, screenStates } from './screenState'

describe('parseScreenState', () => {
  it('returns every allowed state by name', () => {
    for (const state of screenStates) {
      expect(parseScreenState(state, screenStates)).toBe(state)
    }
  })

  it('ignores a state the screen does not offer', () => {
    expect(parseScreenState('confirm', ['empty', 'loading'])).toBeNull()
  })

  it('ignores unknown, missing and non-string values', () => {
    expect(parseScreenState('broken', screenStates)).toBeNull()
    expect(parseScreenState(undefined, screenStates)).toBeNull()
    expect(parseScreenState('', screenStates)).toBeNull()
    expect(parseScreenState(3, screenStates)).toBeNull()
  })

  it('ignores a repeated parameter rather than guessing which one was meant', () => {
    expect(parseScreenState(['empty', 'error'], screenStates)).toBeNull()
  })

  it('is case sensitive, so the URL names exactly one state', () => {
    expect(parseScreenState('Empty', screenStates)).toBeNull()
  })
})

describe('isHarnessEnabled', () => {
  it('is on in vite dev', () => {
    expect(isHarnessEnabled({ DEV: true })).toBe(true)
  })

  it('is on in a build that opts in', () => {
    expect(isHarnessEnabled({ DEV: false, VITE_STATE_HARNESS: '1' })).toBe(true)
  })

  it('is off in a production build', () => {
    expect(isHarnessEnabled({ DEV: false })).toBe(false)
    expect(isHarnessEnabled({ DEV: false, VITE_STATE_HARNESS: '0' })).toBe(false)
    expect(isHarnessEnabled({ DEV: false, VITE_STATE_HARNESS: 'true' })).toBe(false)
  })
})
