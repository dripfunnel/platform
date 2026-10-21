import { DashboardCard, PermissionDenied, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { AttentionItem } from '../../api/dashboard'
import { messages } from '../../messages'

const words = messages.dashboard.attention

const look: Record<AttentionItem['kind'], { tone: StatusTone; icon: StatusIconName }> = {
  pastDue: { tone: 'warning', icon: 'alert' },
  setupStuck: { tone: 'danger', icon: 'cross' },
  domainStuck: { tone: 'warning', icon: 'hour' },
  trialEnding: { tone: 'info', icon: 'hour' },
}

// Each row carries its own permission, the API's answer (FIRST-RELEASE §5): a refused action is
// disabled with the reason and who can.
export const AttentionCard = ({ attention }: { attention: readonly AttentionItem[] }) => (
  <DashboardCard title={words.title} wide>
    {attention.length === 0 ? (
      <p className="df-muted">{words.none}</p>
    ) : (
      <ul className="df-attention">
        {attention.map((item) => (
          <li key={`${item.storeId}-${item.kind}`} className="df-attention-row">
            <StatusPill tone={look[item.kind].tone} icon={look[item.kind].icon} label={words.kinds[item.kind]} />
            <Link to="/stores/$storeId" params={{ storeId: item.storeId }} search={{ tab: item.tab }} className="df-row-title">
              {item.storeName} · {item.detail}
            </Link>
            {item.action.allowed ? (
              <Link to="/stores/$storeId" params={{ storeId: item.storeId }} search={{ tab: item.tab }} className="df-button df-button--small">
                {words.actions[item.kind]}
              </Link>
            ) : (
              <PermissionDenied actionLabel={words.actions[item.kind]} reason={words.refused[item.action.code]} />
            )}
          </li>
        ))}
      </ul>
    )}
  </DashboardCard>
)
