import { describe, expect, it } from 'vitest'
import { Route } from '../../routes/_app/domains'
import { DomainsLoading } from './Domains'

describe('opening Domains', () => {
  it('shows its loading view at once while the addresses load', () => {
    expect(Route.options.pendingMs).toBe(0)
    expect(Route.options.pendingMinMs).toBe(0)
    expect(Route.options.pendingComponent).toBe(DomainsLoading)
  })
})
