import { formatCases, type FormatCase } from '../../format/cases'

export type CheckResult = { group: string; name: string; expected: string; actual: string; passed: boolean }

// A case that throws is a difference too: the engine lacks the feature, which is what the check is for.
export const runChecks = (locale: string, cases: readonly FormatCase[] = formatCases): CheckResult[] =>
  cases.map(({ group, name, actual, expected }) => {
    try {
      const got = actual(locale)
      return { group, name, expected, actual: got, passed: got === expected }
    } catch (error) {
      return { group, name, expected, actual: `threw ${error instanceof Error ? error.name : 'an error'}`, passed: false }
    }
  })

type Hermes = { getRuntimeProperties?: () => Record<string, string> }

export const engineName = (): string => {
  const hermes = (globalThis as { HermesInternal?: Hermes }).HermesInternal
  if (!hermes) return 'not Hermes'
  const version = hermes.getRuntimeProperties?.()['OSS Release Version']
  return version ? `Hermes ${version}` : 'Hermes'
}

// One line per input, quoted so a stray space or non-breaking space is visible; pasted into the PR.
export const reportOf = (results: readonly CheckResult[], header: { engine: string; platform: string; installed: readonly string[] }): string =>
  [
    `HERMES_CHECK engine=${header.engine} platform=${header.platform} polyfills=${header.installed.join('+') || 'none'}`,
    ...results.map((r) => `${r.passed ? 'ok  ' : 'DIFF'} ${r.group} / ${r.name}: expected ${JSON.stringify(r.expected)}${r.passed ? '' : ` got ${JSON.stringify(r.actual)}`}`),
    `HERMES_CHECK ${results.filter((r) => r.passed).length}/${results.length} match`,
  ].join('\n')
