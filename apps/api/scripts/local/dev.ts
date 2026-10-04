import { spawn } from 'node:child_process'

// `pnpm dev` for the Worker: wrangler dev never fires wrangler.jsonc's cron itself, so the outbox,
// the domain checks and the export clean-up would never run locally. This starts it with
// --test-scheduled and calls /__scheduled once a minute, as Cloudflare does on dev and prod.
const port = 8787
const everyMs = 60_000
const scheduled = `http://localhost:${port}/__scheduled?cron=${encodeURIComponent('* * * * *')}`

const wrangler = spawn('wrangler', ['dev', '--env', 'local', '--test-scheduled', '--port', String(port), ...process.argv.slice(2)], { stdio: 'inherit' })

let warned = false
const tick = async () => {
  try {
    const response = await fetch(scheduled, { signal: AbortSignal.timeout(everyMs - 5_000) })
    if (!response.ok) throw new Error(`answered ${response.status}`)
    warned = false
  } catch (error) {
    // Once per outage, not every minute: the Worker may still be starting or reloading.
    if (!warned) console.error(`[cron] the scheduled run didn't happen: ${error instanceof Error ? error.message : 'no answer'}`)
    warned = true
  }
}

const timer = setInterval(() => void tick(), everyMs)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => wrangler.kill(signal))
wrangler.on('exit', (code) => {
  clearInterval(timer)
  process.exit(code ?? 0)
})
