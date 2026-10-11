import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'

// Core's runtime for one core version: react, core's theme entry, the allowed libraries and the frame's boot, built once
// into the image (storefront AI-STUDIO §1) and served beside every bundle under assets/core/ (gate/bundle.ts).
const require = createRequire(import.meta.url)
const identifier = /^[A-Za-z_$][\w$]*$/

/** CommonJS packages (react) re-exported by name, since `export *` can't see a CommonJS module's names. */
const reexport = (spec: string) => {
  const names = Object.keys(require(spec) as object).filter((n) => identifier.test(n) && n !== 'default')
  return `import * as m from '${spec}'\nexport const { ${names.join(', ')} } = m\nexport default m\n`
}

const sources: Readonly<Record<string, () => string>> = {
  react: () => reexport('react'),
  'jsx-runtime': () => reexport('react/jsx-runtime'),
  theme: () => "export * from '@dripfunnel/storefront-core/theme'\n",
  clsx: () => "export * from 'clsx'\n",
  motion: () => "export * from 'motion/react'\n",
}

const virtual: Plugin = {
  name: 'df-runtime-entries',
  setup(b) {
    b.onResolve({ filter: /^df-runtime:/ }, (args) => ({ path: args.path.slice('df-runtime:'.length), namespace: 'df-runtime' }))
    b.onLoad({ filter: /.*/, namespace: 'df-runtime' }, (args) => ({ contents: sources[args.path]?.() ?? '', loader: 'js', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }))
  },
}

const bootEntry = [fileURLToPath(new URL('./boot.tsx', import.meta.url)), fileURLToPath(new URL('./boot.js', import.meta.url))]

export const buildRuntime = async (out: string): Promise<void> => {
  await rm(out, { recursive: true, force: true })
  const boot = bootEntry.find((f) => existsSync(f))
  if (!boot) throw new Error("The frame's boot module is missing.")
  await build({
    entryPoints: [...Object.keys(sources).map((name) => ({ in: `df-runtime:${name}`, out: name })), { in: boot, out: 'boot' }],
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    outdir: out,
    chunkNames: 'chunk-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
    plugins: [virtual],
  })
}
