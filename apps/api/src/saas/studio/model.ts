import type { AiImage } from '#integrations/ai/index'
import type { FileChange, GateProblem } from '#integrations/sandbox/index'

// The designer's model, as the studio's change loop sees it (storefront AI-STUDIO §4 step 2): the Worker calls it with
// the partner's or merchant's key, which never reaches the Durable Object's storage or the container.

/** One exact search-and-replace in a file: `search` must appear exactly once in it (ARCHITECTURE §6.2). */
export type TextEdit = { search: string; replace: string }

/** The model's answer for one file: edits to a file the theme has, a whole new file, or a file to delete. */
export type FileEdit = { path: string; edits: TextEdit[] } | { path: string; content: string } | { path: string; delete: true }

export type Proposal = {
  files: FileEdit[]
  model: string
  tokensIn: number
  tokensOut: number
  /** The part of tokensIn read from the provider's prompt cache. */
  tokensCached?: number
  /** Minor units of costCurrency (DATA-MODEL §7.1). */
  costAmount: number
  costCurrency: string
  /** What changed in plain words and the page to show (FIRST-RELEASE §14); null when the answer had no usable shape. */
  summary?: ProposalSummary | null
  /** The model asked questions or wrote a plan instead of edits (#1243): no gate runs, and the Worker holds what it asked. */
  asked?: boolean
  /** The answer itself was in no usable shape: repaired like a gate failure, never taken as "nothing to change". */
  problems?: GateProblem[]
}

export type ProposalSummary = { reply: string; changed: string[]; page: string | null }

export type ProposalInput = {
  request: string
  theme: { path: string; content: string }[]
  /** The exact problems with the previous answer (its edits or the gate); empty on the first ask (ARCHITECTURE §6.2). */
  problems: GateProblem[]
  /** That previous answer's files as it sent them, so a repair corrects them rather than rewriting blind. */
  previous?: FileEdit[]
  /** Each file of the answer as soon as the model has written it whole, for the pre-check (#1240); its result is never awaited. */
  onFile?: (file: FileEdit) => void | Promise<void>
  /** The model's one sentence on what it understood and will change, as soon as it is whole. */
  onIntro?: (text: string) => void
  /** The sandbox's pre-check of changes over the theme, for the agent's own checks (AI-STUDIO §4 "The agent"). */
  check?: (changes: FileChange[]) => Promise<GateProblem[]>
  /** A picture of one page with changes over the theme, rendered in the sandbox; null when it can't be taken. */
  screenshot?: (changes: FileChange[], page: string) => Promise<AiImage[] | null>
  /** The agent's step for the live feed: never a file's name or content. */
  onStep?: (step: 'reading' | 'editing' | 'checking') => void
}

export interface DesignModel {
  propose: (input: ProposalInput) => Promise<Proposal>
}

/** ARCHITECTURE §6.2: on a gate failure the model repairs from the exact errors, at most three times. */
export const maxRepairs = 5
