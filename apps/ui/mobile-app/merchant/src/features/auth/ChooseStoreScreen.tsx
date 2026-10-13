import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { loadStores, switchStore, type StoreChoice } from '../../api/auth'
import { isApiError } from '../../graphql'
import { t } from '../../messages'
import { session, sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { LinkButton } from '../common/LinkButton'
import { Notice } from '../common/Notice'
import { AuthFrame } from './AuthFrame'
import { decide, type Entry } from './chooseStore'
import { confirmSignOut } from './confirmSignOut'

type ChooserView = { status: 'loading' } | { status: 'error' } | { status: 'ready'; email: string; entries: Entry[]; removed: string | null }

const roleLabel = (choice: StoreChoice): string => {
  if (choice.role === 'owner') return t('auth.role.owner')
  if (choice.role === 'manager') return t('auth.role.manager')
  if (choice.role === 'staff') return t('auth.role.staff')
  return choice.role.startsWith('supplier') ? t('auth.role.supplier') : choice.role
}

// Startup step 5 (ARCHITECTURE.md §4): the person's stores. One opens directly; several are offered here, the last first.
export function ChooseStoreScreen() {
  const { colors, radii } = useTheme()
  const [view, setView] = useState<ChooserView>({ status: 'loading' })
  const [openFailed, setOpenFailed] = useState(false)
  const [removedNow, setRemovedNow] = useState<string | null>(null)

  const open = useCallback(async (entry: Entry) => {
    await switchStore(sessionClient(), entry.choice)
    await session().act(entry.acting)
  }, [])

  const load = useCallback(async () => {
    setView({ status: 'loading' })
    try {
      const { email, stores } = await loadStores(sessionClient())
      const state = session().getState()
      const decision = decide(stores, state.status === 'signedIn' ? state.last : null)
      if (decision.kind === 'none') await session().end('noStores')
      else if (decision.kind === 'open') await open(decision.entry)
      else setView({ status: 'ready', email, entries: decision.entries, removed: decision.removed })
    } catch (failed) {
      // An answer of UNAUTHENTICATED has already ended the session, which sends the person to sign in.
      if (!isApiError(failed, 'UNAUTHENTICATED')) setView({ status: 'error' })
    }
  }, [open])

  useEffect(() => {
    void load()
  }, [load])

  const choose = async (entry: Entry) => {
    setOpenFailed(false)
    try {
      await open(entry)
    } catch (failed) {
      // A store the person no longer holds is refused: the list is read again, without it.
      if (isApiError(failed, 'FORBIDDEN')) {
        setRemovedNow(entry.acting.storeName)
        await load()
      } else if (!isApiError(failed, 'UNAUTHENTICATED')) setOpenFailed(true)
    }
  }

  if (view.status === 'loading') {
    return (
      <AuthFrame title={t('auth.chooseTitle')} sub={t('auth.chooseLoading')}>
        <ActivityIndicator color={colors.muted} />
      </AuthFrame>
    )
  }

  if (view.status === 'error') {
    return (
      <AuthFrame title={t('auth.chooseTitle')} sub={t('auth.chooseError')}>
        <Button label={t('common.tryAgain')} onPress={() => void load()} />
        <LinkButton label={t('auth.signOutLink')} onPress={confirmSignOut} />
      </AuthFrame>
    )
  }

  const removed = removedNow ?? view.removed
  return (
    <AuthFrame title={t('auth.chooseTitle')} sub={t('auth.chooseSub', { email: view.email, count: view.entries.length })}>
      {removed ? <Notice text={t('auth.chooseRemoved', { store: removed })} /> : null}
      {openFailed ? <Notice kind="error" text={t('auth.chooseOpenFailed')} /> : null}
      {view.entries.map((entry) => (
        <Pressable
          key={`${entry.acting.storeId}:${entry.acting.supplierId ?? ''}`}
          accessibilityRole="button"
          onPress={() => void choose(entry)}
          style={[styles.row, { backgroundColor: colors.surface, borderColor: entry.last ? colors.focus : colors.border, borderWidth: entry.last ? 2 : 1, borderRadius: radii.tile }]}
        >
          <View style={[styles.mark, { backgroundColor: colors.side, borderRadius: radii.button }]}>
            <Text style={[styles.initial, { color: colors.sideText }]}>{entry.choice.store.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.names}>
            <Text style={[styles.name, { color: colors.text }]}>{entry.choice.seller ? t('auth.chooseSupplierName', { store: entry.choice.store.name, supplier: entry.choice.seller.name }) : entry.choice.store.name}</Text>
            <Text style={[styles.role, { color: colors.muted }]}>{roleLabel(entry.choice)}</Text>
          </View>
          {entry.last ? (
            <Text style={[styles.badge, { backgroundColor: colors.infoSurface, color: colors.info }]}>{t('auth.chooseLastUsed')}</Text>
          ) : null}
          <Text accessibilityElementsHidden importantForAccessibility="no" style={{ color: colors.muted, fontSize: 20 }}>
            {t('auth.chooseChevron')}
          </Text>
        </Pressable>
      ))}
      <View style={styles.foot}>
        <Text style={{ color: colors.muted }}>{t('auth.chooseNotYou')}</Text>
        <LinkButton label={t('auth.signOutLink')} onPress={confirmSignOut} />
      </View>
    </AuthFrame>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, minHeight: 64 },
  mark: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 16, fontWeight: '800' },
  names: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  role: { fontSize: 13 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
})
