import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { catalogueSnapshotSchema } from '@dripfunnel/storefront-core/guard'
import { secretLikeNames } from '../env'
import { lockdown } from '../lockdown'
import { buildRuntime } from '../runtime/build'
import { buildSite } from './build'
import { checkout } from './source'

// The build image's publish steps (storefront LIVE-SHOP §4 steps 6–7), each run by the locked workflow in its own
// `--network none` container: `build` writes the site and the edge-case renders, or a failing report.

/** The runner's own names: none may reach the AI's code (LIVE-SHOP §4 step 5). */
const runnerName = /^(?:GITHUB_|ACTIONS_|RUNNER_|INPUT_)/

export const refusedEnvironment = (env: NodeJS.ProcessEnv): string[] => [...new Set([...secretLikeNames(env), ...Object.keys(env).filter((k) => runnerName.test(k))])].sort()

const options = {
  source: { type: 'string' },
  commit: { type: 'string' },
  snapshot: { type: 'string' },
  out: { type: 'string' },
} as const

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`--${name} is required.`)
  return value
}

export const runStep = async (argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> => {
  const refused = refusedEnvironment(env)
  if (refused.length > 0) {
    console.error(`The build image holds no credential; refusing to run with ${refused.join(', ')} set.`)
    return 1
  }
  const { positionals, values } = parseArgs({ args: [...argv], options, allowPositionals: true })
  const step = positionals[0]
  if (step !== 'build') throw new Error('Name the step: build.')
  const out = required(values.out, 'out')
  const snapshot = catalogueSnapshotSchema.parse(JSON.parse(await readFile(required(values.snapshot, 'snapshot'), 'utf8')))
  const work = join(out, '.work')
  await mkdir(work, { recursive: true })
  const theme = await checkout(required(values.source, 'source'), required(values.commit, 'commit'), join(work, 'source'))
  // The theme's code renders in this process from here on, and reaches no network.
  lockdown()
  const runtimeDir = env['SANDBOX_RUNTIME'] ?? join(work, 'runtime')
  if (!env['SANDBOX_RUNTIME']) await buildRuntime(runtimeDir)
  const built = await buildSite({ repo: join(work, 'source'), theme, snapshot, runtimeDir, out, work })
  if (!built.ok) await writeFile(join(out, 'report.json'), JSON.stringify(built.report))
  return 0
}
