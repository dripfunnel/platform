import { scopeName } from './developersView'

describe('what a key can do', () => {
  it('is in words, and a scope with none shows as the API names it', () => {
    expect(scopeName('orders.read')).toBe('See orders')
    expect(scopeName('gizmos.write')).toBe('gizmos.write')
  })
})
