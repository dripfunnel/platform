import type { FileChange, GateProblem } from '#integrations/sandbox/index'

// The designer's model, as the studio's change loop sees it (storefront AI-STUDIO §4 step 2): the Worker calls it with
// the partner's or merchant's key, which never reaches the Durable Object's storage or the container.

export type Proposal = {
  files: FileChange[]
  model: string
  tokensIn: number
  tokensOut: number
  /** Minor units of costCurrency (DATA-MODEL §7.1). */
  costAmount: number
  costCurrency: string
  /** What changed in plain words and the page to show (FIRST-RELEASE §14); null when the answer had no usable shape. */
  summary?: ProposalSummary | null
}

export type ProposalSummary = { reply: string; changed: string[]; page: string | null }

export type ProposalInput = {
  request: string
  theme: { path: string; content: string }[]
  /** The gate's exact problems with the previous answer; empty on the first ask (ARCHITECTURE §6.2). */
  problems: GateProblem[]
  /** Aborted when the merchant presses Stop: the model's loop stops asking and stops calling tools. */
  signal?: AbortSignal
}

export interface DesignModel {
  propose: (input: ProposalInput) => Promise<Proposal>
}

/** ARCHITECTURE §6.2: on a gate failure the model repairs from the exact errors, at most three times. */
export const maxRepairs = 3
