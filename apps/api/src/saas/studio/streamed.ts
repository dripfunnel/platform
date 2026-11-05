import type { FileChange, GateProblem } from '#integrations/sandbox/index'
import type { FileEdit } from './model'
import { applyEdits } from './patches'

// Checked as they stream (storefront ARCHITECTURE §6.2, #1240): each file the model finishes is applied to the theme and
// the change so far pre-checked by the sandbox, one check at a time, the newest state only. Nothing here is ever kept:
// the final gate on the whole change decides, and a pre-check of exactly that change adds its problems to the repair.

const same = (a: readonly FileChange[], b: readonly FileChange[]) => a.length === b.length && a.every((f, i) => f.path === b[i]?.path && f.content === b[i]?.content)

const key = (p: GateProblem) => JSON.stringify([p.step, p.file, p.line, p.rule, p.message])

/** The final gate's problems, then the pre-check's that it didn't name (a typecheck the refused validator stopped before). */
export const withPrechecked = (final: readonly GateProblem[], early: readonly GateProblem[]): GateProblem[] => {
  const seen = new Set(final.map(key))
  return [...final, ...early.filter((p) => !seen.has(key(p)))]
}

export class StreamedChecks {
  private readonly files: FileEdit[] = []
  private running: Promise<void> | null = null
  private dirty = false
  private last: { changes: FileChange[]; problems: GateProblem[] } | null = null

  /** `check` failing (an image older than #1240, a sandbox in trouble) only loses the pre-check. */
  constructor(
    private readonly theme: ReadonlyMap<string, string>,
    private readonly check: (changes: FileChange[]) => Promise<GateProblem[]>,
  ) {}

  readonly add = (file: FileEdit): void => {
    this.files.push(file)
    this.dirty = true
    if (this.running) return
    this.running = this.loop().finally(() => {
      this.running = null
    })
  }

  private async loop(): Promise<void> {
    while (this.dirty) {
      this.dirty = false
      // An edit that doesn't apply is the final answer's problem to name, with no sandbox run.
      const applied = applyEdits(this.theme, this.files)
      if (!applied.ok || applied.changes.length === 0) continue
      const changes = applied.changes
      this.last = await this.check(changes).then(
        (problems) => ({ changes, problems }),
        () => null,
      )
    }
  }

  /** The pre-check's problems when it checked exactly `changes`, the change the answer ended with; else none. */
  async problemsFor(changes: readonly FileChange[]): Promise<GateProblem[]> {
    await this.running
    return this.last && same(this.last.changes, changes) ? this.last.problems : []
  }
}
