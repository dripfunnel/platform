import type { ApiKey, ApiKeyChoices } from '../../api/developers'
import { messages } from '../../messages'
import { ApiKeysCard } from './ApiKeysCard'
import './developers.css'

const words = messages.settings.developers

export interface DevelopersData {
  keys: ApiKey[]
  choices: ApiKeyChoices
  suppliers: { id: string; name: string }[]
}

/** What the tab reads again after a write. */
export interface DevelopersReads {
  keys: () => Promise<ApiKey[]>
}

export interface DevelopersTabProps {
  data: DevelopersData
  reads: DevelopersReads
  canEdit: boolean
  onToast: (text: string) => void
}

/** Developers (SetDev "developers", FIRST-RELEASE §15): API keys, the Owner's. */
export const DevelopersTab = ({ data, reads, canEdit, onToast }: DevelopersTabProps) => (
  <div className="df-set-store df-dev">
    <div>
      <h2 className="df-set-title">{words.title}</h2>
      <p className="df-set-sub">{words.sub}</p>
    </div>
    <ApiKeysCard initial={data.keys} choices={data.choices} suppliers={data.suppliers} read={reads.keys} canEdit={canEdit} onToast={onToast} />
  </div>
)
