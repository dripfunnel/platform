import { describe, expect, it } from 'vitest'
import { partnerConsoleUrlFor, productionPartnerConsoleUrl } from './partnerConsole'

describe('partnerConsoleUrlFor', () => {
  it('uses the partner console’s dev port under vite dev, or Caddy’s host when the portal is behind it', () => {
    expect(partnerConsoleUrlFor({ DEV: true, VITE_PLATFORM_URL: 'https://platform-x.example' })).toBe('http://localhost:5174')
    expect(partnerConsoleUrlFor({ DEV: true }, 'localhost')).toBe('http://localhost:5174')
    expect(partnerConsoleUrlFor({ DEV: true }, 'store.akshaylocal.localhost')).toBe('https://platform.localhost')
    expect(partnerConsoleUrlFor({ DEV: false }, 'store.akshaylocal.localhost')).toBe(productionPartnerConsoleUrl)
  })

  it('uses the build’s https VITE_PLATFORM_URL, and production otherwise', () => {
    expect(partnerConsoleUrlFor({ DEV: false, VITE_PLATFORM_URL: 'https://dev-platform.actuateminds.com' })).toBe('https://dev-platform.actuateminds.com')
    expect(partnerConsoleUrlFor({ DEV: false, VITE_PLATFORM_URL: 'http://platform.example' })).toBe(productionPartnerConsoleUrl)
    expect(partnerConsoleUrlFor({ DEV: false })).toBe(productionPartnerConsoleUrl)
  })
})
