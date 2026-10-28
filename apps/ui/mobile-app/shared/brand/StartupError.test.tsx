import { act, create } from 'react-test-renderer'
import { Text } from 'react-native'
import { StartupError } from './StartupError'

describe('the start-up error', () => {
  it('shows the app’s wording and lets the person try again', () => {
    const onRetry = jest.fn()
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<StartupError title="It failed" retryLabel="Again" onRetry={onRetry} />)
    })

    expect(tree.root.findAllByType(Text).map((node) => node.props.children)).toEqual(['It failed', 'Again'])

    const button = tree.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function')[0]
    act(() => button?.props.onPress())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
