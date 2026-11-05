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
  /** US cents per million tokens (ai_run.cost_amount): input, output, and input read from or written to the prompt cache. */
  centsPerMillion: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export const modelCapabilities: readonly ModelCapability[] = [
  { provider: 'anthropic', id: 'claude-opus-5-5', maxOutputTokens: 64_000, temperature: [0, 1], centsPerMillion: { input: 400, output: 2000, cacheRead: 20, cacheWrite: 500 } },
  { provider: 'anthropic', id: 'claude-sonnet-5-5', maxOutputTokens: 64_000, temperature: [0, 1], centsPerMillion: { input: 300, output: 1500, cacheRead: 20, cacheWrite: 375 } },
  { provider: 'anthropic', id: 'claude-haiku-4-5', maxOutputTokens: 64_000, temperature: [0, 1], centsPerMillion: { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 } },
  { provider: 'anthropic', id: 'claude-haiku-5-5', maxOutputTokens: 32_000, temperature: [0, 1], centsPerMillion: { input: 100, output: 500, cacheRead: 10, cacheWrite: 125 } },
  { provider: 'openai', id: 'gpt-5', maxOutputTokens: 32_000, temperature: [0, 2], centsPerMillion: { input: 125, output: 1000, cacheRead: 12.5, cacheWrite: 125 } },
  { provider: 'openai', id: 'gpt-5-mini', maxOutputTokens: 32_000, temperature: [0, 2], centsPerMillion: { input: 25, output: 200, cacheRead: 2.5, cacheWrite: 25 } },
]

export const capabilityOf = (provider: GatewayProvider, model: string): ModelCapability | null => modelCapabilities.find((m) => m.provider === provider && m.id === model) ?? null

export const modelsOf = (provider: GatewayProvider): readonly string[] => modelCapabilities.filter((m) => m.provider === provider).map((m) => m.id)

/** `tokensIn` counts the cached tokens too, as CanonicalUsage does; each part is priced at its own rate, rounded up once. */
export const costOf = (m: ModelCapability, tokensIn: number, tokensOut: number, cache: { read: number; write: number } = { read: 0, write: 0 }): number => {
  const { input, output, cacheRead, cacheWrite } = m.centsPerMillion
  const plain = Math.max(0, tokensIn - cache.read - cache.write)
  return Math.ceil((plain * input + cache.read * cacheRead + cache.write * cacheWrite + tokensOut * output) / 1_000_000)
}
