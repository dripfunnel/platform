import { describe, expect, it } from 'vitest'
import { applyTheme, parseThemeChoice, resolveTheme, themeStore } from './theme'

describe('parseThemeChoice', () => {
  it('accepts the three choices', () => {
    expect(parseThemeChoice('system')).toBe('system')
    expect(parseThemeChoice('light')).toBe('light')
    expect(parseThemeChoice('dark')).toBe('dark')
  })

  it('falls back to system for anything else', () => {
    for (const value of [null, undefined, '', 'Dark', 'auto', 42, {}]) {
      expect(parseThemeChoice(value)).toBe('system')
    }
  })
})

describe('resolveTheme', () => {
  it('follows the system only when nothing is chosen', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('lets an explicit choice beat the system in both directions', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('applyTheme', () => {
  // A stub rather than jsdom: this package's tests run in node, and the helper touches only
  // `dataset`.
  const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement

  it('marks dark with the attribute and light with its absence', () => {
    const element = root()
    applyTheme(element, 'dark')
    expect(element.dataset.theme).toBe('dark')
    applyTheme(element, 'light')
    expect('theme' in element.dataset).toBe(false)
  })
})

describe('themeStore', () => {
  const fake = (): Storage => {
    const values = new Map<string, string>()
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
      removeItem: (key) => void values.delete(key),
      clear: () => values.clear(),
      key: () => null,
      get length() {
        return values.size
      },
    } as Storage
  }

  it('round-trips a choice, and stores system as absence', () => {
    const storage = fake()
    const store = themeStore('df-admin-theme', storage)
    store.write('dark')
    expect(store.read()).toBe('dark')
    store.write('system')
    expect(storage.getItem('df-admin-theme')).toBeNull()
    expect(store.read()).toBe('system')
  })

  it('follows the system when storage throws, rather than breaking the app', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    const store = themeStore('df-admin-theme', throwing)
    expect(store.read()).toBe('system')
    expect(() => store.write('dark')).not.toThrow()
  })

  it('works where storage does not exist at all', () => {
    const store = themeStore('df-admin-theme', undefined)
    expect(store.read()).toBe('system')
    expect(() => store.write('light')).not.toThrow()
  })
})
