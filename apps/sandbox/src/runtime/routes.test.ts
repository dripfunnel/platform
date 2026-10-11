import { describe, expect, it } from 'vitest'
import { routeAt } from './routes'

describe('the preview’s route for an address', () => {
  it.each([
    ['/', { route: 'home' }],
    ['/cart/', { route: 'cart' }],
    ['/cart', { route: 'cart' }],
    ['/sign-in/', { route: 'signIn' }],
    ['/account/', { route: 'account' }],
    ['/account/orders/', { route: 'accountOrders' }],
    ['/account/orders/1051/', { route: 'accountOrder' }],
    ['/products/linen-shirt/', { route: 'product' }],
    ['/collections/new-in', { route: 'collection' }],
    ['/policies/returns/', { route: 'policy' }],
    ['/order/kt-1051/', { route: 'orderConfirmation' }],
    ['/about/', { custom: '/about' }],
    ['/our/story', { custom: '/our/story' }],
    ['/products/', { route: 'notFound' }],
    ['/nowhere/', { route: 'notFound' }],
  ])('%s', (path, found) => {
    expect(routeAt(path, ['/about', '/our/story'])).toEqual(found)
  })
})
