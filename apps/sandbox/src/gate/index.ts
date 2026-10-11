import { validateChange, type GuardContext, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import { bundle, type ClientBundle } from './bundle'
import { overBudget, weigh, type Weight } from './budgets'
import type { GateProblem } from './problems'
import { typecheck } from './typecheck'

export type { ClientBundle } from './bundle'
export type { GateProblem, GateStep } from './problems'

export type GateResult = { ok: true; bundle: ClientBundle; weight: Weight } | { ok: false; problems: GateProblem[] }

/** The validator first, on the files alone: nothing reaches the disk before every path and line passed it. */
export const validate = (files: readonly ThemeFile[], context: GuardContext): GateProblem[] =>
  validateChange(files, context).problems.map((p) => ({ step: 'validator', ...p }))

/** Typecheck, bundle and byte budgets (storefront ARCHITECTURE §6.2) over the working copy the validated files are in. */
export const build = async (theme: ReadonlyMap<string, string>, repo: string, out: string): Promise<GateResult> => {
  const types = typecheck(theme)
  if (types.length > 0) return { ok: false, problems: types }
  const bundled = await bundle(repo, out)
  if (!bundled.ok) return bundled
  const weight = await weigh(out, bundled.bundle)
  const over = overBudget(weight)
  return over.length > 0 ? { ok: false, problems: over } : { ok: true, bundle: bundled.bundle, weight }
}
