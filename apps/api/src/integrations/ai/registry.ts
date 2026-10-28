import type { GatewayProvider } from './gateway'

// The models the gateway will call and what each is known to take (#950). A model not listed is refused before a provider
// is asked, so a caller can't send an arbitrary model name; two models are never assumed alike in limits or price.
export interface ModelCapability {
  provider: GatewayProvider
  id: string
  /** The most tokens one answer may be asked for. */
  maxOutputTokens: number
  /** Temperature range the provider accepts. */
  temperature: readonly [number, number]
  /** US cents per million tokens, input and output (ai_run.cost_amount). */
  centsPerMillion: { input: number; output: number }
}

export const modelCapabilities: readonly ModelCapability[] = [
  { provider: 'anthropic', id: 'claude-opus-5-5', maxOutputTokens: 64_000, temperature: [0, 1], centsPerMillion: { input: 400, output: 2000 } },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', maxOutputTokens: 64_000, temperature: [0, 1], centsPerMillion: { input: 300, output: 1500 } },
  { provider: 'anthropic', id: 'claude-haiku-4-5', maxOutputTokens: 64_000, temperature: [0, 1], centsPerMillion: { input: 100, output: 500 } },
  { provider: 'anthropic', id: 'claude-haiku-5-5', maxOutputTokens: 32_000, temperature: [0, 1], centsPerMillion: { input: 100, output: 500 } },
  { provider: 'openai', id: 'gpt-5', maxOutputTokens: 32_000, temperature: [0, 2], centsPerMillion: { input: 125, output: 1000 } },
  { provider: 'openai', id: 'gpt-5-mini', maxOutputTokens: 32_000, temperature: [0, 2], centsPerMillion: { input: 25, output: 200 } },
]

export const capabilityOf = (provider: GatewayProvider, model: string): ModelCapability | null => modelCapabilities.find((m) => m.provider === provider && m.id === model) ?? null

export const modelsOf = (provider: GatewayProvider): readonly string[] => modelCapabilities.filter((m) => m.provider === provider).map((m) => m.id)

export const costOf = (m: ModelCapability, tokensIn: number, tokensOut: number): number => Math.ceil((tokensIn * m.centsPerMillion.input + tokensOut * m.centsPerMillion.output) / 1_000_000)
