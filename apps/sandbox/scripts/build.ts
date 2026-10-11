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
  // Core's root entry is bundled in (its files import without extensions, which Node can't load); everything else stays
  // in the image's node_modules, guard included, which reads core's types beside it.
  external: ['@dripfunnel/storefront-core/guard', 'clsx', 'esbuild', 'motion', 'react', 'react/*', 'react-dom', 'react-dom/*', 'typescript', 'zod'],
  logLevel: 'warning',
})
await buildRuntime(`${dist}runtime-files`)
