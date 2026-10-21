import type { Environment } from './environment'
import './shell.css'

// The strip under the header naming the environment (design.md §4). Only prod is red.
export const EnvironmentBanner = ({ environment, words }: { environment: Environment; words: { name: string; warning: string } }) => (
  <div className={`df-env-banner df-env-banner--${environment}`}>
    <strong>{words.name}</strong> {words.warning}
  </div>
)
