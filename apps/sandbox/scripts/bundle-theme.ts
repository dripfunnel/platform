import { bundle } from '../src/gate/bundle'

// Builds one theme's preview bundle into <out> and prints the result as JSON; apps/api's seed-templates.ts runs it (#902).
const [repo, out] = process.argv.slice(2)
if (!repo || !out) throw new Error('usage: bundle-theme.ts <theme folder> <out folder>')
console.log(JSON.stringify(await bundle(repo, out)))
