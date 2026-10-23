import { useState } from 'react'
import { Text } from 'react-native'
import { loadSubscription, type StoreSubscription } from '../../../api/settingsStore'
import { formatDay } from '@dripfunnel/mobile-shared/format'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { locale, t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { LinkButton } from '../../common/LinkButton'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { useLoad } from '../../common/useLoad'
import { useShell } from '../../shell/ShellData'
import { CloseStoreSheet, type CloseStep } from './CloseStoreSheet'

// Close my store (MA 18, #511), at the end of Store info for the Owner (FIRST-RELEASE (mobile) §1). It reads the plan on its own, so a plan that
// can't be read leaves the three cards above working. A store that is already closing keeps the way to its data (the cancelled banner promises it).
export function CloseStoreCard({ client }: { client: ApiClient }) {
  const { colors } = useTheme()
  const { acting, refresh } = useShell()
  const loaded = useLoad(() => loadSubscription(client), [client])
  const [open, setOpen] = useState<CloseStep | null>(null)
  const { state, set } = loaded

  if (state.status === 'loading') return null
  if (state.status === 'error') {
    return (
      <SectionCard title={t('settings.store.close.title')}>
        <Notice kind="error" text={t('settings.store.close.loadFailed')} />
        <Button kind="secondary" label={t('settings.store.close.retry')} onPress={loaded.reload} />
      </SectionCard>
    )
  }
  const sub = state.data
  if (!sub) return null

  const closing = sub.cancelAt !== null || sub.status === 'cancelled'
  const onClosed = (after: StoreSubscription) => {
    set(after)
    refresh()
  }
  return (
    <>
      {closing ? (
        <SectionCard title={t('settings.store.close.closingTitle')}>
          <Text style={{ color: colors.textStrong, fontSize: 14, lineHeight: 22 }}>{t('settings.store.close.closingBody', { date: formatDay((sub.cancelAt ?? sub.periodEnd).slice(0, 10), locale) })}</Text>
          <LinkButton label={t('settings.store.close.downloadData')} onPress={() => setOpen('export')} />
        </SectionCard>
      ) : (
        <SectionCard title={t('settings.store.close.title')} sub={t('settings.store.close.sub')}>
          <LinkButton danger label={t('settings.store.close.open')} onPress={() => setOpen('consequence')} />
        </SectionCard>
      )}
      {open ? <CloseStoreSheet sub={sub} storeName={acting.storeName} client={client} start={open} onClosed={onClosed} onClose={() => setOpen(null)} /> : null}
    </>
  )
}
