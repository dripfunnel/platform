import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { corePackage } from './changesets.mjs'

// The release workflow's two steps (docs/code/ARCHITECTURE.md §5): `pack` packs core once, if its
// version isn't published yet; `publish` publishes that same tarball and tags it.

export const tagFor = (version) => `${corePackage}@${version}`

/** Reads `npm view`'s outcome: a version, or absent on E404; any other failure is thrown. */
export const publishedVersion = (view) => {
  if (view.ok) return JSON.parse(view.stdout || 'null')
  if (/E404|404 Not Found/.test(view.stderr)) return null
  throw new Error(`npm view failed: ${view.stderr.trim()}`)
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const npmView = (spec) => {
  try {
    return { ok: true, stdout: run('npm', ['view', spec, 'version', '--json']), stderr: '' }
  } catch (error) {
    return { ok: false, stdout: '', stderr: String(error.stderr ?? error.message) }
  }
}

const output = (pairs) => {
  const file = process.env.GITHUB_OUTPUT
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
  if (file) appendFileSync(file, lines)
  else process.stdout.write(lines)
}

const coreVersion = () => JSON.parse(readFileSync('packages/storefront-core/package.json', 'utf8')).version

const pack = () => {
  const version = coreVersion()
  if (publishedVersion(npmView(`${corePackage}@${version}`)) === version) {
    console.log(`${tagFor(version)} is already published; nothing to release.`)
    output({ release: 'false' })
    return
  }
  const dir = join(process.cwd(), '.release')
  mkdirSync(dir, { recursive: true })
  run('pnpm', ['--filter', corePackage, 'pack', '--pack-destination', dir])
  const tarball = readdirSync(dir).find((f) => f.endsWith(`-${version}.tgz`))
  if (!tarball) throw new Error(`No tarball for ${version} in ${dir}`)
  output({ release: 'true', version, tarball: join(dir, tarball) })
}

const publish = () => {
  const { TARBALL: tarball, VERSION: version } = process.env
  if (!tarball || !version) throw new Error('TARBALL and VERSION are required')
  run('npm', ['publish', tarball, '--access', 'restricted'])
  run('git', ['tag', tagFor(version)])
  run('git', ['push', 'origin', tagFor(version)])
  console.log(`Published and tagged ${tagFor(version)}.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const step = { pack, publish }[process.argv[2] ?? '']
  if (!step) {
    console.error('Usage: publish.mjs pack|publish')
    process.exit(2)
  }
  step()
}
