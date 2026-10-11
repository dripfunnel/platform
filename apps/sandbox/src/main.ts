import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { sandboxConfig, secretLikeNames } from './env'
import { lockdown } from './lockdown'
import { buildRuntime } from './runtime/build'
import { sandboxServer } from './server'

// AGENTS.md "Security": configuration is checked at boot, and the process exits on a bad value.
const secrets = secretLikeNames(process.env)
if (secrets.length > 0) {
  console.error(`The sandbox holds no credential; refusing to start with ${secrets.join(', ')} set.`)
  process.exit(1)
}
const config = sandboxConfig(process.env)
await mkdir(config.workRoot, { recursive: true })
// The image carries the runtime prebuilt (SANDBOX_RUNTIME); the local stand-in builds it at start.
const runtimeDir = config.runtimeDir ?? join(config.workRoot, 'runtime')
if (config.runtimeDir === null) await buildRuntime(runtimeDir)
lockdown()
sandboxServer({ slots: config.slots, workRoot: config.workRoot, runtimeDir }).listen(config.port, () => console.log(`sandbox listening on ${config.port}`))
