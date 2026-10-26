import { Linking } from 'react-native'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { t } from '../../messages'
import { fakeShop, hasText, press, pressableNamed, render } from '../../testing/harness'
import { clampZoom, Gallery, maxZoom, tapZoom } from './Gallery'

jest.setTimeout(120_000)

type Callbacks = { runOnJS?: boolean | undefined; onUpdate?: ((event: { scale: number }) => void) | undefined; onFinalize?: (() => void) | undefined; onEnd?: (() => void) | undefined; taps?: number | undefined }
const mockPinch: { config: Callbacks } = { config: {} }
const mockTap: { config: Callbacks } = { config: {} }
const mockPlayerFor = jest.fn()

// The native gesture and video modules do not run in a test: the builders record how the gallery set them up, and the player is a stub.
jest.mock('react-native-gesture-handler', () => {
  const builderFor = (record: { config: Callbacks }) => {
    const builder = {
      runOnJS: (value: boolean) => {
        record.config.runOnJS = value
        return builder
      },
      numberOfTaps: (value: number) => {
        record.config.taps = value
        return builder
      },
      onUpdate: (callback: Callbacks['onUpdate']) => {
        record.config.onUpdate = callback
        return builder
      },
      onFinalize: (callback: Callbacks['onFinalize']) => {
        record.config.onFinalize = callback
        return builder
      },
      onEnd: (callback: Callbacks['onEnd']) => {
        record.config.onEnd = callback
        return builder
      },
    }
    return builder
  }
  return { Gesture: { Pinch: () => builderFor(mockPinch), Tap: () => builderFor(mockTap), Simultaneous: () => ({}) }, GestureDetector: ({ children }: { children: unknown }) => children }
})
jest.mock('expo-video', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native')
  return {
    useVideoPlayer: (url: string) => {
      mockPlayerFor(url)
      return {}
    },
    VideoView: (props: object) => <View testID="video" {...props} />,
  }
})

const photo = (n: number) => ({ url: `https://cdn.example/${n}.jpg`, alt: `Photo ${n}`, versionId: null })
const shop = fakeShop(() => null)

const mainPhoto = (screen: ReactTestRenderer) => screen.root.findAll((node) => node.props.accessibilityRole === 'image' && typeof node.props.onAccessibilityAction === 'function')[0]

describe('the gallery', () => {
  it('shows the first photo with its alt text, and no thumbnails for a single photo', async () => {
    const screen = await render(<Gallery photos={[photo(1)]} video={null} name="Linen Tee" />, shop)
    expect(screen.root.findAll((node) => node.props.accessibilityLabel === 'Photo 1').length).toBeGreaterThan(0)
    expect(screen.root.findAll((node) => node.props.accessibilityRole === 'tab')).toHaveLength(0)
  })

  it('moves to the photo whose thumbnail is chosen', async () => {
    const screen = await render(<Gallery photos={[photo(1), { ...photo(2), alt: null }]} video={null} name="Linen Tee" />, shop)
    await press(screen, t('product.photoOf', { number: 2, count: 2, name: 'Linen Tee' }))
    expect(screen.root.findAll((node) => node.props.accessibilityLabel === 'Photo 1' && node.props.accessibilityRole === 'image')).toHaveLength(0)
    expect(screen.root.findAll((node) => node.props.accessibilityRole === 'image' && node.props.accessibilityLabel === t('product.photoOf', { number: 2, count: 2, name: 'Linen Tee' })).length).toBeGreaterThan(0)
  })

  it('plays a hosted video in the player, last among the thumbnails', async () => {
    const screen = await render(<Gallery photos={[photo(1)]} video={{ fileUrl: 'https://cdn.example/v.mp4', pageUrl: null }} name="Linen Tee" />, shop)
    expect(screen.root.findAllByProps({ testID: 'video' })).toHaveLength(0)
    await press(screen, t('product.watchVideo'))
    expect(screen.root.findAllByProps({ testID: 'video' }).length).toBeGreaterThan(0)
    expect(mockPlayerFor).toHaveBeenCalledWith('https://cdn.example/v.mp4')
  })

  it('opens a video that is a link to a page, rather than playing it', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const screen = await render(<Gallery photos={[photo(1)]} video={{ fileUrl: null, pageUrl: 'https://videos.example/watch/1' }} name="Linen Tee" />, shop)
    await press(screen, t('product.watchVideo'))
    expect(hasText(screen, t('product.watchVideo'))).toBe(true)
    await act(async () => pressableNamed(screen, t('product.watchVideo')).props.onPress())
    expect(open).toHaveBeenCalledWith('https://videos.example/watch/1')
  })

  it('offers no link for a video with neither a file nor a page', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    open.mockClear()
    const screen = await render(<Gallery photos={[photo(1)]} video={{ fileUrl: null, pageUrl: null }} name="Linen Tee" />, shop)
    await press(screen, t('product.watchVideo'))
    expect(screen.root.findAll((node) => node.props.accessibilityRole === 'link')).toHaveLength(0)
    expect(open).not.toHaveBeenCalled()
  })

  it('zooms with a pinch no further than the limit, and settles back when the fingers lift', async () => {
    await render(<Gallery photos={[photo(1)]} video={null} name="Linen Tee" />, shop)
    expect(mockPinch.config.runOnJS).toBe(true)
    expect(clampZoom(9)).toBe(maxZoom)
    expect(clampZoom(0.2)).toBe(1)
    expect(clampZoom(2.5)).toBe(2.5)
    act(() => {
      mockPinch.config.onUpdate?.({ scale: 2 })
      mockPinch.config.onFinalize?.()
    })
  })

  it('zooms with a double tap, a way that needs one finger, and a second double tap takes it back', async () => {
    const screen = await render(<Gallery photos={[photo(1)]} video={null} name="Linen Tee" />, shop)
    expect(mockTap.config.taps).toBe(2)
    expect(mainPhoto(screen)?.props.accessibilityValue).toEqual({})
    await act(async () => mockTap.config.onEnd?.())
    expect(mainPhoto(screen)?.props.accessibilityValue).toEqual({ text: t('product.zoomed') })
    expect(tapZoom).toBeLessThanOrEqual(maxZoom)
    await act(async () => mockTap.config.onEnd?.())
    expect(mainPhoto(screen)?.props.accessibilityValue).toEqual({})
  })

  it('offers a screen reader the zoom as an action, named for what it will do', async () => {
    const screen = await render(<Gallery photos={[photo(1)]} video={null} name="Linen Tee" />, shop)
    expect(mainPhoto(screen)?.props.accessibilityActions).toEqual([{ name: 'magnify', label: t('product.zoomIn') }])
    await act(async () => mainPhoto(screen)?.props.onAccessibilityAction({ nativeEvent: { actionName: 'magnify' } }))
    expect(mainPhoto(screen)?.props.accessibilityActions).toEqual([{ name: 'magnify', label: t('product.zoomOut') }])
  })
})
