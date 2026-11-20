import { describe, expect, it } from 'vitest'
import { Route } from '../../routes/_app/domains'
import { DomainsLoading } from './Domains'

// #1589: the click on "Go to Domains" must show the loading view at once, not after the router's default delay.
describe('opening Domains', () => {
  it('shows its loading view at once while the addresses load', () => {
    expect(Route.options.pendingMs).toBe(0)
    expect(Route.options.pendingComponent).toBe(DomainsLoading)
  })
})
