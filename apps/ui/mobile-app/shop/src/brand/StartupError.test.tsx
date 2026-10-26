import { act, create } from 'react-test-renderer'
import { Text } from 'react-native'
import { t } from '../messages'
import { StartupError } from './StartupError'

describe('the start-up error', () => {
  it('says the app could not start in the messages, and lets the person try again', () => {
    const onRetry = jest.fn()
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<StartupError onRetry={onRetry} />)
    })

    const words = tree.root.findAllByType(Text).map((node) => node.props.children)
    expect(words).toEqual([t('startup.failed'), t('startup.retry')])

    const button = tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0]
    act(() => button?.props.onPress())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
