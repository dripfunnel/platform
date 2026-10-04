import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkDatabase } from './database'
import { checkEnv } from './env'
import type { Finding } from './finding'
import { checkWorkerPort } from './port'

// `pnpm check:local [--setup]`: what `pnpm dev` and `pnpm setup:local` need, each failure with
// its fix (docs/api/README.md §7). --setup skips what setup is about to do itself.
const mode = process.argv.includes('--setup') ? 'setup' : 'full'
const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url))
const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url))

const run = async (): Promise<Finding[]> => {
  const envFindings = checkEnv(process.env, existsSync(envFile))
  if (envFindings.some((f) => f.level === 'error')) return envFindings
  const databaseUrl = process.env.DATABASE_URL ?? ''
  const later = await Promise.all([checkDatabase(databaseUrl, migrationsDir, mode), mode === 'full' ? checkWorkerPort() : []])
  return [...envFindings, ...later.flat()]
}

const findings = await run()
const errors = findings.filter((f) => f.level === 'error')
for (const f of findings) {
  console.error(`${f.level === 'error' ? '✗' : '!'} ${f.problem}\n    Fix: ${f.fix}`)
}
if (errors.length > 0) {
  console.error(`\nLocal setup isn't ready: ${errors.length} problem(s) above (docs/api/README.md §7).`)
  process.exit(1)
}
console.log(`Local setup OK${findings.length > 0 ? `, with ${findings.length} warning(s)` : ''}.`)
