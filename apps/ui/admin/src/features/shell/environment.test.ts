import { describe, expect, it } from 'vitest'
import { environmentFor } from './environment'

describe('environmentFor', () => {
  it('says Production only on the production host', () => {
    expect(environmentFor('admin.dripfunnel.com')).toBe('production')
  })

  it.each(['admin-dev.dripfunnel.com', '17-admin-shell-admin.dripfunnel.ai', 'localhost', '127.0.0.1'])(
    'says Staging on %s',
    (hostname) => {
      expect(environmentFor(hostname)).toBe('staging')
    },
  )

  it('does not mistake a look-alike host for production', () => {
    expect(environmentFor('admin.dripfunnel.com.example.net')).toBe('staging')
    expect(environmentFor('evil-admin.dripfunnel.com')).toBe('staging')
  })
})
