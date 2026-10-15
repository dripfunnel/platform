import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer'
import { actingAs, hasText, press, pressableNamed, renderShell } from '../../testing/harness'
import { Chip } from './Chip'
import { Switch } from './Switch'

// The first render of a file pays for loading the native-component mocks, which a cold CI cache and a busy runner stretch past the 30 s default.
jest.setTimeout(120_000)

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
jest.mock('../../session', () => ({ session: () => ({ leaveStore: jest.fn(), end: jest.fn() }) }))

// The control's own Pressable, which carries its state; the harness's pressable is the outermost component with an onPress.
const control = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.props.accessibilityState !== undefined)[0] as ReactTestInstance

describe('Chip', () => {
  it('runs what it is for when pressed, and says what it holds in its name', async () => {
    const onPress = jest.fn()
    const renderer = await renderShell(<Chip label="Linen" hint="9" onPress={onPress} />, { acting: actingAs('owner') })

    await press(pressableNamed(renderer, 'Linen9'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('shows a ticked one with a tick and as selected, and an unticked one as neither', async () => {
    const on = await renderShell(<Chip label="Linen" selected onPress={jest.fn()} />)
    const off = await renderShell(<Chip label="Cotton" onPress={jest.fn()} />)

    expect(hasText(on, '✓ Linen')).toBe(true)
    expect((control(on).props as { accessibilityState: { selected: boolean } }).accessibilityState.selected).toBe(true)
    expect(hasText(off, '✓')).toBe(false)
    expect((control(off).props as { accessibilityState: { selected: boolean } }).accessibilityState.selected).toBe(false)
  })

  it('is off while it is disabled, and takes the name it is given over its label', async () => {
    const renderer = await renderShell(<Chip label="+ Add" accessibilityLabel="Add a value to Fabric" disabled onPress={jest.fn()} />)

    expect((control(renderer).props as { disabled: boolean; accessibilityLabel: string }).disabled).toBe(true)
    expect((control(renderer).props as { accessibilityLabel: string }).accessibilityLabel).toBe('Add a value to Fabric')
  })
})

describe('Switch', () => {
  it('hands back the opposite of what it shows when pressed, and says whether it is on', async () => {
    const onChange = jest.fn()
    const off = await renderShell(<Switch label="Visible on your store" value={false} onChange={onChange} />)
    const on = await renderShell(<Switch label="Visible on your store" value onChange={onChange} />)

    expect((control(off).props as { accessibilityState: { checked: boolean } }).accessibilityState.checked).toBe(false)
    expect((control(on).props as { accessibilityState: { checked: boolean } }).accessibilityState.checked).toBe(true)
    await press(pressableNamed(off, 'Visible on your store'))
    await press(pressableNamed(on, 'Visible on your store'))
    expect(onChange.mock.calls).toEqual([[true], [false]])
  })

  it('is off while it is disabled', async () => {
    const renderer = await renderShell(<Switch label="Hidden" value={false} disabled onChange={jest.fn()} />)

    expect((control(renderer).props as { disabled: boolean }).disabled).toBe(true)
  })
})
