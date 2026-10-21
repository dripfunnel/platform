import { StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import { t } from '../../../messages'
import { frameAddress, frameMayLoad } from './studioRules'
import type { Frame } from './useStudioSession'

type Props = { frame: Frame; path: string }

// AI-written code on the store's preview origin (AI-STUDIO §1, §8): a private web view with no token, no injected script and no `onMessage`,
// so no native bridge. It loads only under its own session's address; the page picker moves it by changing that address.
export function StudioFrame({ frame, path }: Props) {
  return (
    <WebView
      source={{ uri: frameAddress(frame.frameUrl, path) }}
      originWhitelist={[`${frame.origin}/*`]}
      onShouldStartLoadWithRequest={(request) => frameMayLoad(request.url, frame.frameUrl)}
      incognito
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      allowFileAccess={false}
      allowsLinkPreview={false}
      accessibilityLabel={t('storefront.studio.frameTitle')}
      style={styles.frame}
    />
  )
}

const styles = StyleSheet.create({ frame: { flex: 1 } })
