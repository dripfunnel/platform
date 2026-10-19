import { appOfLink, siteOf } from './appView'

const id = 'c0a80101-1234-4abc-8def-0123456789ab'

describe('the app an install link names', () => {
  it('is the first UUID anywhere in an https link, in lower case', () => {
    expect(appOfLink(`https://ledgersync.app/install/${id}`)).toEqual({ kind: 'app', id })
    expect(appOfLink(`  https://ledgersync.app/install?app=${id.toUpperCase()}&x=1  `)).toEqual({ kind: 'app', id })
    expect(appOfLink(`https://ledgersync.app/${id}/and/${'11111111-2222-4333-8444-555555555555'}`)).toEqual({ kind: 'app', id })
  })

  it('is refused when the link is not https', () => {
    for (const link of [`http://ledgersync.app/install/${id}`, `javascript:alert('${id}')`, `ledgersync.app/install/${id}`, '', 'https://', 'https://a b/x']) {
      expect(appOfLink(link)).toEqual({ kind: 'notHttps' })
    }
  })

  it('names no app when an https link holds no UUID', () => {
    expect(appOfLink('https://ledgersync.app/install/ledger')).toEqual({ kind: 'noApp' })
    expect(appOfLink('https://ledgersync.app/install/c0a80101-1234-4abc-8def')).toEqual({ kind: 'noApp' })
  })
})

describe('an app’s own site', () => {
  it('opens only when it is an https address', () => {
    expect(siteOf('https://ledgersync.app')).toBe('https://ledgersync.app')
    for (const site of ['http://ledgersync.app', 'ledgersync.app', 'javascript:alert(1)', 'https://', 'intent://scan#Intent;end']) expect(siteOf(site)).toBeNull()
  })
})
