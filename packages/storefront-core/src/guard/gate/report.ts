// The full gate's report (storefront ARCHITECTURE §4.2 step 3): each check's pass or fail in plain words, never code.
// It goes to the API as it is (LIVE-SHOP §4 step 7) and is kept on publish_run.gate.

export const gateChecks = ['validator', 'contracts', 'sealed', 'checkout', 'axe', 'budgets', 'no-js', 'crawl', 'content', 'visual-diff', 'edge-cases'] as const

export type GateCheckName = (typeof gateChecks)[number]

export type GateCheck = { name: GateCheckName; passed: boolean; detail?: string }

export type GateReport = { passed: boolean; checks: GateCheck[] }

/** The API keeps at most this much of each check's words. */
export const maxDetail = 500

const clip = (text: string) => (text.length <= maxDetail ? text : `${text.slice(0, maxDetail - 1)}…`)

/** One check from its problems: it passes with none; its words are the first problems and how many more there are. */
export const gateCheck = (name: GateCheckName, problems: readonly string[], passedDetail?: string): GateCheck => {
  if (problems.length === 0) return passedDetail === undefined ? { name, passed: true } : { name, passed: true, detail: clip(passedDetail) }
  const unique = [...new Set(problems)]
  const shown = unique.slice(0, 3).join(' ')
  return { name, passed: false, detail: clip(unique.length > 3 ? `${shown} And ${unique.length - 3} more.` : shown) }
}

/** Every check in its order; one that never ran fails, so a step stopped part-way never reads as a pass. */
export const gateReport = (checks: readonly GateCheck[]): GateReport => {
  const ordered = gateChecks.map((name) => checks.find((c) => c.name === name) ?? { name, passed: false, detail: 'This check did not run.' })
  return { passed: ordered.every((c) => c.passed), checks: ordered }
}
