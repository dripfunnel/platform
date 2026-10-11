import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { buildRuntime } from '../src/runtime/build'

// dist/main.js is the server, its packages left to the image's node_modules; dist/runtime-files is core's runtime for
// the frame, built once per image (storefront AI-STUDIO §1).
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
await rm(dist, { recursive: true, force: true })
await build({
  entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))],
  outfile: `${dist}main.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
})
await buildRuntime(`${dist}runtime-files`)
