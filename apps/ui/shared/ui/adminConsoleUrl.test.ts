import { describe, expect, it } from 'vitest'
import { adminConsoleUrlFor, productionAdminUrl } from './adminConsoleUrl'

describe('adminConsoleUrlFor', () => {
  it('uses the admin console’s dev port under vite dev', () => {
    expect(adminConsoleUrlFor({ DEV: true, VITE_ADMIN_URL: 'https://admin-x.example' })).toBe('http://localhost:5175')
  })

  it('uses the build’s https VITE_ADMIN_URL, and production otherwise', () => {
    expect(adminConsoleUrlFor({ DEV: false, VITE_ADMIN_URL: 'https://admin-feature.dripfunnel.dev' })).toBe('https://admin-feature.dripfunnel.dev')
    expect(adminConsoleUrlFor({ DEV: false, VITE_ADMIN_URL: 'http://localhost:5175' })).toBe(productionAdminUrl)
    expect(adminConsoleUrlFor({ DEV: false })).toBe(productionAdminUrl)
  })
})
