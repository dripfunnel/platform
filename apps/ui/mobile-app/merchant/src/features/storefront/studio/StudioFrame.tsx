import { useState } from 'react'
import { StyleSheet } from 'react-native'
import { WebView } from 'react-native-webview'
import { t } from '../../../messages'
import { frameAddress, frameMayLoad } from './studioRules'
import type { Frame } from './useStudioSession'

type Props = { frame: Frame; path: string }

// AI-written code on the store's preview origin (AI-STUDIO §1, §8): a private web view with no token, no injected script and no `onMessage`, so no native bridge.
// Android doesn't ask `onShouldStartLoadWithRequest` for every redirect or sub-frame, so an address outside the session is also put back at the session's own page.
export function StudioFrame({ frame, path }: Props) {
  const [restarts, setRestarts] = useState(0)
  return (
    <WebView
      key={restarts}
      source={{ uri: frameAddress(frame.frameUrl, path) }}
      originWhitelist={[`${frame.origin}/*`]}
      onShouldStartLoadWithRequest={(request) => frameMayLoad(request.url, frame.frameUrl)}
      onNavigationStateChange={(state) => {
        if (state.url !== 'about:blank' && !frameMayLoad(state.url, frame.frameUrl)) setRestarts((n) => n + 1)
      }}
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
