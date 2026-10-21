import type { ApiKey, ApiKeyChoices, WebhookDelivery, WebhookEndpoint } from '../../api/developers'
import { messages } from '../../messages'
import { ApiKeysCard } from './ApiKeysCard'
import './developers.css'
import { WebhooksCard } from './WebhooksCard'

const words = messages.settings.developers

export interface DevelopersData {
  keys: ApiKey[]
  choices: ApiKeyChoices
  suppliers: { id: string; name: string }[]
  hooks: WebhookEndpoint[]
  events: string[]
}

/** What the tab reads again after a write, and an endpoint's deliveries when they're opened. */
export interface DevelopersReads {
  keys: () => Promise<ApiKey[]>
  hooks: () => Promise<WebhookEndpoint[]>
  deliveries: (endpointId: string) => Promise<WebhookDelivery[]>
}

export interface DevelopersTabProps {
  data: DevelopersData
  reads: DevelopersReads
  canEdit: boolean
  onToast: (text: string) => void
}

/** Developers (SetDev "developers", FIRST-RELEASE §15): API keys and webhooks, the Owner's. */
export const DevelopersTab = ({ data, reads, canEdit, onToast }: DevelopersTabProps) => (
  <div className="df-set-store df-dev">
    <div>
      <h2 className="df-set-title">{words.title}</h2>
      <p className="df-set-sub">{words.sub}</p>
    </div>
    <ApiKeysCard initial={data.keys} choices={data.choices} suppliers={data.suppliers} read={reads.keys} canEdit={canEdit} onToast={onToast} />
    <WebhooksCard initial={data.hooks} events={data.events} read={reads.hooks} deliveries={reads.deliveries} canEdit={canEdit} onToast={onToast} />
  </div>
)
