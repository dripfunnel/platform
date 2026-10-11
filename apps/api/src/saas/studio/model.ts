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
}

export type ProposalInput = {
  request: string
  theme: { path: string; content: string }[]
  /** The gate's exact problems with the previous answer; empty on the first ask (ARCHITECTURE §6.2). */
  problems: GateProblem[]
}

export interface DesignModel {
  propose: (input: ProposalInput) => Promise<Proposal>
}

/** ARCHITECTURE §6.2: on a gate failure the model repairs from the exact errors, at most three times. */
export const maxRepairs = 3
