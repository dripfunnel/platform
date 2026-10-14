import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Icon } from '../shell/Icon'
import type { ScreenState } from './scenario'

export type StateKind = Exclude<ScreenState, 'normal'>

export type StateActions = {
  onRetry: () => void
  onHome: () => void
  onSignIn: () => void
  onSwitchStore: () => void
}

type Props = StateActions & {
  kind: StateKind
  /** What the screen is called, for "We couldn’t load {label}" and "You don’t have access to {label}". */
  label: string
  store: string
  supplier: boolean
  /** Quoted to support when a load fails: a sample in the Scenario menu, and none until the API sends a request id to quote. */
  reference: string | null
}

export function Skeleton() {
  const { colors } = useTheme()
  const block = (height: number, width: number | `${number}%`, key: string) => <View key={key} style={{ height, width, borderRadius: 8, backgroundColor: colors.skeleton }} />
  return (
    <View accessibilityLabel={t('states.loading')} accessibilityRole="progressbar" style={styles.skeleton}>
      {block(28, 220, 'a')}
      {block(44, '100%', 'b')}
      {block(64, '100%', 'c')}
      {block(64, '100%', 'd')}
      {block(64, '100%', 'e')}
    </View>
  )
}

// The designed states (DESIGN.md §4): each says what happened, that nothing is lost, and what to do next.
export function StateView({ kind, label, store, supplier, reference, onRetry, onHome, onSignIn, onSwitchStore }: Props) {
  const { colors } = useTheme()
  if (kind === 'slow') {
    return (
      <View>
        <Skeleton />
        <Text accessibilityLiveRegion="polite" style={[styles.note, { color: colors.muted }]}>
          {t('states.slow')}
        </Text>
      </View>
    )
  }

  const view = {
    loadErr: { title: t('states.loadErr.title', { name: label }), body: t('states.loadErr.body'), primary: { label: t('common.tryAgain'), onPress: onRetry }, secondary: { label: t('states.goHome'), onPress: onHome }, mark: '!' },
    notFound: { title: t('states.notFound.title'), body: t('states.notFound.body'), primary: { label: t('states.goHome'), onPress: onHome }, secondary: null, mark: '404' },
    denied: {
      title: t('states.denied.title', { name: label }),
      body: supplier ? t('states.denied.bodySupplier', { name: label, store }) : t('states.denied.body', { name: label }),
      primary: { label: t('states.goHome'), onPress: onHome },
      secondary: null,
      mark: 'lock',
    },
    expired: { title: t('states.expired.title'), body: t('auth.notice.expired'), primary: { label: t('auth.signInButton'), onPress: onSignIn }, secondary: null, mark: '!' },
    removed: { title: t('states.removed.title', { store }), body: t('auth.chooseRemoved', { store }), primary: { label: t('shell.switchStore'), onPress: onSwitchStore }, secondary: null, mark: 'lock' },
    offline: { title: t('banners.offline.title'), body: t('states.offline.body'), primary: { label: t('common.tryAgain'), onPress: onRetry }, secondary: null, mark: '!' },
  }[kind]

  return (
    <View accessibilityRole={kind === 'loadErr' || kind === 'offline' ? 'alert' : undefined} style={styles.state}>
      {view.mark === 'lock' ? (
        <View style={[styles.badge, { backgroundColor: colors.infoSurface }]}>
          <Icon name="lock" size={22} color={colors.info} strokeWidth={1.8} />
        </View>
      ) : view.mark === '404' ? (
        <Text style={[styles.code, { color: colors.link }]}>{view.mark}</Text>
      ) : (
        <View style={[styles.badge, { backgroundColor: colors.warningSurface }]}>
          <Text style={[styles.bang, { color: colors.link }]}>{view.mark}</Text>
        </View>
      )}
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {view.title}
      </Text>
      <Text style={[styles.body, { color: colors.muted }]}>{view.body}</Text>
      <View style={styles.actions}>
        <Button label={view.primary.label} onPress={view.primary.onPress} />
        {view.secondary ? <Button kind="secondary" label={view.secondary.label} onPress={view.secondary.onPress} /> : null}
      </View>
      {kind === 'loadErr' && reference !== null ? <Text style={[styles.ref, { color: colors.muted }]}>{t('states.loadErr.ref', { ref: reference })}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  skeleton: { padding: 24, gap: 12 },
  note: { textAlign: 'center', paddingHorizontal: 24, fontSize: 14 },
  state: { alignItems: 'center', gap: 12, paddingHorizontal: 28, paddingVertical: 56 },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  bang: { fontSize: 22, fontWeight: '800' },
  code: { fontSize: 12, letterSpacing: 1.4, fontFamily: 'monospace' },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: 8, paddingTop: 8 },
  ref: { fontSize: 11, textAlign: 'center', fontFamily: 'monospace' },
})
