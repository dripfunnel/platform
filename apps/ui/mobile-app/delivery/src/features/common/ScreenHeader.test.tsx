import { StyleSheet } from 'react-native'
import { fakeSession, render } from '../../testing/harness'
import { ScreenHeader } from './ui'

// The first render loads react-native's lazy modules cold, over 30 s on a loaded CI runner (as HomeScreen.test.tsx), so it is paid once, here.
beforeAll(async () => {
  await render(<ScreenHeader title="Warm" />, fakeSession(() => ({})))
}, 120_000)

const headerStyle = async (top: number) => {
  const screen = await render(<ScreenHeader title="Delivery" />, fakeSession(() => ({})), { top })
  const header = screen.root.findAll((node) => (node.type as unknown) === 'View' && StyleSheet.flatten(node.props.style)?.borderBottomWidth === 1)[0]
  return StyleSheet.flatten(header?.props.style)
}

describe('ScreenHeader', () => {
  it('starts below the status bar and keeps its own height under it', async () => {
    const style = await headerStyle(30)
    expect(style).toMatchObject({ paddingTop: 30, minHeight: 86 })
  })

  it('adds nothing where there is no status bar to clear', async () => {
    const style = await headerStyle(0)
    expect(style).toMatchObject({ paddingTop: 0, minHeight: 56 })
  })
})
