import type { ShopClient } from '../platform/api/client'

/** What core reports to the platform: a sealed component not seen, a section or the checkout that threw (ARCHITECTURE §3.5). */
export type StorefrontProblem = { kind: 'sealed' | 'section' | 'checkout'; subject: string; detail?: string }

type Reporter = (problem: StorefrontProblem) => void

let reporter: Reporter | null = null
let sent = new Set<string>()
// A boundary can catch in the first commit, before the provider's effect sets the reporter: those wait for it.
let waiting: StorefrontProblem[] = []

/** Where reports go; each problem goes once per page. */
export const setProblemReporter = (next: Reporter | null) => {
  reporter = next
  sent = new Set()
  if (!next) return
  const held = waiting
  waiting = []
  held.forEach(reportProblem)
}

export const reportProblem = (problem: StorefrontProblem) => {
  const key = `${problem.kind}|${problem.subject}|${problem.detail ?? ''}`
  if (sent.has(key)) return
  sent.add(key)
  if (reporter) reporter(problem)
  else waiting.push(problem)
}

// Names only, never the address or an error's message: a studio address holds its session (AI-STUDIO §8).
export const reportMutation = 'mutation Report($kind: ShopProblemKind!, $subject: String!, $detail: String) { reportStorefrontProblem(kind: $kind, subject: $subject, detail: $detail) }'

/** Sends each problem to the Shop API's reportStorefrontProblem, dropping it if that fails. */
export const shopProblemReporter =
  (client: ShopClient): Reporter =>
  (problem) => {
    client.request(reportMutation, { kind: problem.kind.toUpperCase(), subject: problem.subject, detail: problem.detail ?? null }).catch(() => undefined)
  }
