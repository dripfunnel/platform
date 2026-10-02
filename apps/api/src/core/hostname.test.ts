import { describe, expect, it } from 'vitest'
import { parseHostname } from './hostname'

describe('parseHostname', () => {
  it('accepts a host and a wildcard, lower-cased and without a trailing dot', () => {
    expect(parseHostname(' Store.Northstar.example. ')).toEqual({ ok: true, host: 'store.northstar.example', wildcard: false })
    expect(parseHostname('*.shops.northstar.example')).toEqual({ ok: true, host: '*.shops.northstar.example', wildcard: true })
  })

  it('refuses every kind of address and local name, so nothing private can be looked up', () => {
    for (const [input, code] of [
      ['10.0.0.1', 'IS_ADDRESS'],
      ['169.254.169.254', 'IS_ADDRESS'],
      ['127.0.0.1', 'IS_ADDRESS'],
      ['[fe80::1]', 'IS_ADDRESS'],
      ['fe80::1', 'IS_ADDRESS'],
      ['localhost', 'NO_DOT'],
      ['db.localhost', 'LOCAL_NAME'],
      ['printer.local', 'LOCAL_NAME'],
      ['metadata.internal', 'LOCAL_NAME'],
      ['1.2.3', 'LOCAL_NAME'],
      ['', 'EMPTY'],
      ['bad_label.example', 'BAD_LABEL'],
      ['-x.example', 'BAD_LABEL'],
      [`${'a'.repeat(250)}.example`, 'TOO_LONG'],
    ] as const) {
      expect([input, parseHostname(input)]).toEqual([input, { ok: false, code }])
    }
  })
})
