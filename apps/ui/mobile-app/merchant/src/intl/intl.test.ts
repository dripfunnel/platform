const load = () => jest.requireActual<typeof import('./index')>('./index')

// FormatJS judges Intl.Locale incomplete wherever it lacks `variants`, which includes Node, so `locale` is not asserted.
const formatting = ['getcanonicallocales', 'pluralrules', 'numberformat', 'listformat']

describe('the Intl polyfills', () => {
  it('replace nothing that formatting needs on an engine that already has it, as Node does', () => {
    jest.isolateModules(() => {
      expect(load().polyfilledIntl().filter((name) => formatting.includes(name))).toEqual([])
    })
  })

  it('replace what the engine lacks, and the formatter then works', () => {
    const intl = Intl as unknown as Record<string, unknown>
    const original = intl.ListFormat
    delete intl.ListFormat
    try {
      jest.isolateModules(() => {
        expect(load().polyfilledIntl().filter((name) => formatting.includes(name))).toEqual(['listformat'])
        expect(new Intl.ListFormat('en', { type: 'conjunction' }).format(['a', 'b', 'c'])).toBe('a, b, and c')
      })
    } finally {
      Object.defineProperty(Intl, 'ListFormat', { value: original, writable: true, configurable: true })
    }
  })

  it('give an engine without PluralRules the English plural rules', () => {
    const intl = Intl as unknown as Record<string, unknown>
    const original = intl.PluralRules
    delete intl.PluralRules
    try {
      jest.isolateModules(() => {
        expect(load().polyfilledIntl()).toContain('pluralrules')
        const rules = new Intl.PluralRules('en')
        expect([rules.select(0), rules.select(1), rules.select(2)]).toEqual(['other', 'one', 'other'])
      })
    } finally {
      Object.defineProperty(Intl, 'PluralRules', { value: original, writable: true, configurable: true })
    }
  })
})
