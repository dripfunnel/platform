import { describe, expect, it } from 'vitest'
import { judge, nameToResolve } from './check'

describe('judging a DNS answer (SAAS.md §8)', () => {
  const expected = 'portal.edge.dripfunnel.example'

  it('goes live when the record points at us, whatever the case', () => {
    expect(judge('waiting', expected, ['PORTAL.edge.dripfunnel.example'])).toEqual({ status: 'live', found: 'PORTAL.edge.dripfunnel.example' })
  })

  it('waits while there is no record, fails when it points elsewhere', () => {
    expect(judge('waiting', expected, [])).toEqual({ status: 'waiting', found: null })
    expect(judge('waiting', expected, ['old.host.example'])).toEqual({ status: 'failed', found: 'old.host.example' })
  })

  it('is broken, not waiting, once a live record changes or disappears', () => {
    expect(judge('live', expected, [])).toEqual({ status: 'broken', found: null })
    expect(judge('live', expected, ['elsewhere.example'])).toEqual({ status: 'broken', found: 'elsewhere.example' })
    expect(judge('broken', expected, [expected])).toEqual({ status: 'live', found: expected })
  })

  it('probes a wildcard through a name under it', () => {
    expect(nameToResolve('*.shops.northstar.example')).toBe('df-probe.shops.northstar.example')
    expect(nameToResolve('store.northstar.example')).toBe('store.northstar.example')
  })
})
