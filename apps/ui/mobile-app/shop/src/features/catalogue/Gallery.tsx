import { Image } from 'expo-image'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Photo, ProductVideo } from '../../api/catalogue'
import { t } from '../../messages'

export const maxZoom = 4

export const clampZoom = (scale: number): number => Math.min(maxZoom, Math.max(1, scale))

/** How far a double tap, or the screen reader's zoom action, magnifies: the single-pointer way to zoom (WCAG 2.2, 2.5.1). */
export const tapZoom = 2

/** A photo that grows under a pinch, up to `maxZoom`, and settles back when the fingers lift; a double tap holds it at `tapZoom`, and again takes it back. */
function ZoomablePhoto({ photo, label }: { photo: Photo; label: string }) {
  const scale = useRef(new Animated.Value(1)).current
  const [zoomed, setZoomed] = useState(false)
  const rest = useRef(1)
  rest.current = zoomed ? tapZoom : 1
  useEffect(() => {
    Animated.spring(scale, { toValue: zoomed ? tapZoom : 1, useNativeDriver: true }).start()
  }, [zoomed, scale])
  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onUpdate((event) => scale.setValue(clampZoom(rest.current * event.scale)))
      .onFinalize(() => Animated.spring(scale, { toValue: rest.current, useNativeDriver: true }).start())
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .runOnJS(true)
      .onEnd(() => setZoomed((now) => !now))
    return Gesture.Simultaneous(pinch, doubleTap)
  }, [scale])
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        accessibilityValue={zoomed ? { text: t('product.zoomed') } : {}}
        accessibilityActions={[{ name: 'magnify', label: zoomed ? t('product.zoomOut') : t('product.zoomIn') }]}
        onAccessibilityAction={() => setZoomed((now) => !now)}
        style={[styles.fill, { transform: [{ scale }] }]}
      >
        <Image source={{ uri: photo.url }} accessibilityIgnoresInvertColors contentFit="cover" style={styles.fill} />
      </Animated.View>
    </GestureDetector>
  )
}

function VideoSlide({ url, label }: { url: string; label: string }) {
  const player = useVideoPlayer(url)
  return <VideoView player={player} nativeControls allowsPictureInPicture={false} accessibilityLabel={label} style={styles.fill} />
}

/** A video that is a web page, not a file: opened in the browser. */
function WatchLink({ url }: { url: string }) {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={t('product.watchVideo')} onPress={() => void Linking.openURL(url).catch(() => undefined)} style={styles.watch}>
      <Text style={{ color: colors.link, fontWeight: '700', fontSize: 16 }}>{t('product.watchVideo')}</Text>
    </Pressable>
  )
}

/** The product's photos (pinch or double-tap to zoom) and its video, one big and the rest as thumbnails. The screen keys it by version, so a new version starts at its first photo. */
export function Gallery({ photos, video, name }: { photos: Photo[]; video: ProductVideo | null; name: string }) {
  const { colors } = useTheme()
  const slides = video ? photos.length + 1 : photos.length
  const [index, setIndex] = useState(0)
  const current = Math.min(index, Math.max(slides - 1, 0))
  const onVideo = video !== null && current === photos.length

  return (
    <View>
      <View style={[styles.main, { backgroundColor: colors.skeleton }]}>
        {onVideo && video ? (
          video.fileUrl ? (
            <VideoSlide url={video.fileUrl} label={t('product.video', { name })} />
          ) : video.pageUrl ? (
            <WatchLink url={video.pageUrl} />
          ) : null
        ) : photos[current] ? (
          <ZoomablePhoto photo={photos[current]} label={photos[current].alt ?? t('product.photoOf', { number: current + 1, count: photos.length, name })} />
        ) : null}
      </View>
      {slides > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs} accessibilityRole="tablist">
          {Array.from({ length: slides }, (_, i) => {
            const isVideo = video !== null && i === photos.length
            const photo = photos[i]
            return (
              <Pressable
                key={i}
                accessibilityRole="tab"
                accessibilityState={{ selected: i === current }}
                accessibilityLabel={isVideo ? t('product.watchVideo') : t('product.photoOf', { number: i + 1, count: photos.length, name })}
                onPress={() => setIndex(i)}
                style={[styles.thumb, { borderColor: i === current ? colors.focus : 'transparent', backgroundColor: colors.skeleton }]}
              >
                {photo ? <Image source={{ uri: photo.url }} accessibilityIgnoresInvertColors contentFit="cover" style={styles.fill} /> : null}
                {isVideo ? <Text style={{ color: colors.text, fontSize: 18 }}>▶</Text> : null}
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  main: { aspectRatio: 4 / 5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fill: { width: '100%', height: '100%' },
  watch: { minHeight: 44, justifyContent: 'center', padding: 16 },
  thumbs: { gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  thumb: { width: 52, height: 64, borderRadius: 8, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
})
