import { createHash } from 'node:crypto'
import { validateTheme, type GuardContext, type ThemeFile } from '@dripfunnel/storefront-core/guard'
import { bundle, WarmBundle, type ClientBundle } from './bundle'
import { overBudget, weigh, type Weight } from './budgets'
import type { Lane } from './lanes'
import type { GateProblem } from './problems'
import { typecheck, warmTypecheck, type WarmCheck } from './typecheck'

export type { ClientBundle } from './bundle'
export type { Lane } from './lanes'
export type { GateProblem, GateStep } from './problems'

export type GateResult = { ok: true; bundle: ClientBundle; weight: Weight } | { ok: false; problems: GateProblem[] }

const filesOf = (theme: ReadonlyMap<string, string>): ThemeFile[] => [...theme].map(([path, content]) => ({ path, content }))

/** The validator first, on the files alone: nothing reaches the disk before every path and line passed it. */
export const validate = async (files: readonly ThemeFile[], context: GuardContext): Promise<GateProblem[]> =>
  (await validateTheme(files, context)).problems.map((p) => ({ step: 'validator', ...p }))

const weighed = async (bundled: Awaited<ReturnType<typeof bundle>>, out: string): Promise<GateResult> => {
  if (!bundled.ok) return bundled
  const weight = await weigh(out, bundled.bundle)
  const over = overBudget(weight)
  return over.length > 0 ? { ok: false, problems: over } : { ok: true, bundle: bundled.bundle, weight }
}

/** Typecheck, bundle and byte budgets (storefront ARCHITECTURE §6.2) from cold: the reference the warm gate is held to. */
export const build = async (theme: ReadonlyMap<string, string>, repo: string, out: string): Promise<GateResult> => {
  const types = typecheck(theme)
  if (types.length > 0) return { ok: false, problems: types }
  return weighed(await bundle(repo, out), out)
}

/**
 * One slot's fast gate, kept warm between changes (#1240): a builder program for the typecheck, an esbuild context for
 * the bundle, and the validator's answer for the exact theme and store it last read. A new draft gets a new one.
 */
export class WarmGate {
  private readonly types = warmTypecheck()
  private readonly bundler: WarmBundle
  private validated: { key: string; problems: GateProblem[] } | null = null

  constructor(
    private readonly repo: string,
    private readonly out: string,
  ) {
    this.bundler = new WarmBundle(repo, out)
  }

  get contexts(): number {
    return this.bundler.contexts
  }

  /** The validator, run again only when a byte of the theme or the store's context differs from its last answer's. */
  async validate(theme: ReadonlyMap<string, string>, context: GuardContext): Promise<GateProblem[]> {
    const files = filesOf(theme)
    const key = createHash('sha256').update(JSON.stringify([files, context])).digest('hex')
    if (this.validated?.key === key) return this.validated.problems
    const problems = await validate(files, context)
    this.validated = { key, problems }
    return problems
  }

  typecheck(theme: ReadonlyMap<string, string>): WarmCheck {
    return this.types(theme)
  }

  /** The gate after the validator: the typecheck unless the lane skips it, then the bundle and the byte budgets. */
  async build(theme: ReadonlyMap<string, string>, lane: Lane): Promise<GateResult & { checked: string[] | null }> {
    const types = lane === 'full' ? this.types(theme) : null
    if (types && types.problems.length > 0) return { ok: false, problems: types.problems, checked: types.checked }
    return { ...(await weighed(await this.bundler.run(), this.out)), checked: types?.checked ?? null }
  }

  /** The bundle alone, for a loaded draft's first frame. */
  bundle(): ReturnType<WarmBundle['run']> {
    return this.bundler.run()
  }

  dispose(): Promise<void> {
    return this.bundler.dispose()
  }
}
