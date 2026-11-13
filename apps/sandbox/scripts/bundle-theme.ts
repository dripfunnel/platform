import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { bundle, runtimeFolder } from '../src/gate/bundle'
import { buildRuntime } from '../src/runtime/build'

// Builds one theme's preview bundle into <out>, core's runtime under assets/core/ beside it (PREVIEW §3), and prints
// the result as JSON; apps/api's seed-templates.ts runs it (#902).
const [repo, out] = process.argv.slice(2)
if (!repo || !out) throw new Error('usage: bundle-theme.ts <theme folder> <out folder>')
const built = await bundle(repo, out)
if (built.ok) {
  await buildRuntime(join(out, runtimeFolder))
  const names = await readdir(join(out, runtimeFolder))
  for (const name of names) built.bundle.files.push({ path: `${runtimeFolder}${name}`, bytes: (await stat(join(out, runtimeFolder, name))).size })
}
console.log(JSON.stringify(built))
