import { messages } from '../../messages'
import type { Environment } from './environment'
import './shell.css'

export const EnvironmentBanner = ({ environment }: { environment: Environment }) => {
  const words = messages.shell.environment[environment]
  return (
    <div className={`df-env-banner df-env-banner--${environment}`}>
      <strong>{words.name}</strong> {words.warning}
    </div>
  )
}
