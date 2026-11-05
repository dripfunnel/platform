import { describe, expect, it } from 'vitest'
import type { FileChange, GateProblem } from '#integrations/sandbox/index'
import { StreamedChecks, withPrechecked } from './streamed'

const theme = new Map([
  ['src/theme/pages/HomePage.tsx', 'export const HomePage = () => <main />\n'],
  ['src/theme/styles/theme.css', '@theme { --color-ink: #111; }\n'],
])
const typeProblem: GateProblem = { step: 'typecheck', file: 'src/theme/pages/HomePage.tsx', line: 1, rule: 'ts/2322', message: 'No.' }
const validatorProblem: GateProblem = { step: 'validator', file: 'src/theme/pages/HomePage.tsx', line: 1, rule: 'code/fetch', message: 'No fetch.' }

/** A sandbox whose pre-checks answer only when released, recording what each one checked. */
const sandbox = () => {
  const checked: FileChange[][] = []
  const waiting: (() => void)[] = []
  const check = (changes: FileChange[]) => {
    checked.push(changes)
    return new Promise<GateProblem[]>((resolve) => waiting.push(() => resolve(changes.some((c) => c.path.endsWith('.tsx')) ? [typeProblem] : [])))
  }
  const release = async () => {
    waiting.shift()?.()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { checked, check, release }
}

describe('the pre-check as the answer streams (#1240)', () => {
  it('checks one state at a time, skipping to the newest, and keeps the problems of exactly the final change', async () => {
    const s = sandbox()
    const streamed = new StreamedChecks(theme, s.check)
    streamed.add({ path: 'src/theme/styles/theme.css', edits: [{ search: '#111', replace: '#222' }] })
    streamed.add({ path: 'src/theme/pages/HomePage.tsx', edits: [{ search: '<main />', replace: '<main id="a" />' }] })
    streamed.add({ path: 'src/theme/pages/HomePage.tsx', edits: [{ search: 'id="a"', replace: 'id="b"' }] })
    await s.release()
    await s.release()
    expect(s.checked.map((c) => c.map((f) => f.path))).toEqual([['src/theme/styles/theme.css'], ['src/theme/styles/theme.css', 'src/theme/pages/HomePage.tsx']])
    const final = s.checked[1] ?? []
    expect(await streamed.problemsFor(final)).toEqual([typeProblem])
    expect(await streamed.problemsFor(final.slice(0, 1))).toEqual([])
  })

  it('skips a file whose edits don’t apply and a check that failed, losing only the pre-check', async () => {
    const streamed = new StreamedChecks(theme, async () => {
      throw new Error('an older image has no pre-check')
    })
    streamed.add({ path: 'src/theme/pages/HomePage.tsx', edits: [{ search: 'not there', replace: 'x' }] })
    streamed.add({ path: 'src/theme/styles/theme.css', content: '@theme {}\n' })
    expect(await streamed.problemsFor([{ path: 'src/theme/styles/theme.css', content: '@theme {}\n' }])).toEqual([])
  })

  it('adds to the final gate’s problems only those it didn’t name', () => {
    expect(withPrechecked([validatorProblem], [validatorProblem, typeProblem])).toEqual([validatorProblem, typeProblem])
    expect(withPrechecked([typeProblem], [])).toEqual([typeProblem])
  })
})
