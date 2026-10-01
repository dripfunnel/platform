import { messages } from '../../messages'
import type { Environment } from './environment'
import '@dripfunnel/shared/ui/shell.css'
import './environment.css'

export const EnvironmentBanner = ({ environment }: { environment: Environment }) => {
  const words = messages.shell.environment[environment]
  return (
    <div className={`df-env-banner df-env-banner--${environment}`}>
      <strong>{words.name}</strong> {words.warning}
    </div>
  )
}
