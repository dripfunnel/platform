import { useState } from 'react'
import { loadMarkets } from '../../../api/settingsMarkets'
import { loadLocale } from '../../../api/settingsStore'
import { ApiError } from '../../../graphql'
import { t } from '../../../messages'
import { sessionClient } from '../../../session'
import { stateOfError, useLoad } from '../../common/useLoad'
import { useShell } from '../../shell/ShellData'
import { Skeleton } from '../../states/StateView'
import { ShellScreen } from '../../states/ShellScreen'
import { settingsAccess } from '../access'
import { MarketForm } from './MarketForm'

type Props = { id: string | null; suggested: string }

// Opens one market, or a new one (`id` null) named `suggested`. Owner only, like all of Settings: anyone else is told so and nothing is read. A market
// that isn't here is the shell's 404.
export function MarketEditorScreen({ id, suggested }: Props) {
  const client = sessionClient()
  const { seat, state } = useShell()
  const { allowed, canEdit } = settingsAccess(seat, state?.readOnly === true)
  const [notice, setNotice] = useState<string | null>(null)
  const loaded = useLoad(
    async () => {
      if (!allowed) return new Promise<never>(() => undefined)
      const [markets, loc] = await Promise.all([loadMarkets(client), loadLocale(client)])
      if (!loc) throw new Error('locale missing')
      const market = id === null ? null : (markets.find((candidate) => candidate.id === id) ?? null)
      if (id !== null && market === null) throw new ApiError('NOT_FOUND', 'market')
      return { markets, loc, market }
    },
    [client, id, allowed],
  )

  if (allowed && loaded.state.status === 'ready') {
    const { markets, loc, market } = loaded.state.data
    return (
      <MarketForm
        key={market?.revision ?? 'new'}
        client={client}
        markets={markets}
        loc={loc}
        market={market}
        suggested={suggested}
        canEdit={canEdit}
        notice={notice}
        onStale={(message) => {
          setNotice(message)
          loaded.reload()
        }}
      />
    )
  }
  return (
    <ShellScreen label={t('settings.tabs.markets')} onRetry={loaded.reload} {...(!allowed ? { state: 'denied' as const } : loaded.state.status === 'error' ? { state: stateOfError(loaded.state.error) } : {})}>
      <Skeleton />
    </ShellScreen>
  )
}
