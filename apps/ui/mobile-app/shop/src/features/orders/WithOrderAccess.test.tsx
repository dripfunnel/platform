import { Text } from 'react-native'
import { t } from '../../messages'
import { fakeShop, hasText, press, render } from '../../testing/harness'
import { WithOrderAccess } from './WithOrderAccess'

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

describe('reading an order the way its owner does', () => {
  it('shows what is below once the order’s access is known', async () => {
    const screen = await render(
      <WithOrderAccess orderId="o-1">
        <Text>the order</Text>
      </WithOrderAccess>,
      fakeShop(() => ({}), { signedIn: true }),
    )
    expect(hasText(screen, 'the order')).toBe(true)
  })

  it('shows the error state with a retry, not a skeleton for ever, when the keystore fails, and goes on once it answers', async () => {
    const shop = fakeShop(() => ({}), { signedIn: true })
    let attempts = 0
    const failing = { ...shop, orderAccess: () => (++attempts === 1 ? Promise.reject(new Error('keystore')) : shop.orderAccess('o-1')) }
    const screen = await render(
      <WithOrderAccess orderId="o-1">
        <Text>the order</Text>
      </WithOrderAccess>,
      failing,
    )
    expect(hasText(screen, t('states.error.title'))).toBe(true)
    expect(hasText(screen, 'the order')).toBe(false)
    await press(screen, t('states.retry'))
    expect(hasText(screen, 'the order')).toBe(true)
    expect(attempts).toBe(2)
  })
})
