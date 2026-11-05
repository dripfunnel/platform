import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { localMessageMarker, type LocalMessage } from '#integrations/local/index'
import { cronDue, wranglerCrons } from './cron'

// `pnpm dev` for the Worker: wrangler dev never fires wrangler.jsonc's crons itself, so the outbox,
// the domain checks and the clean-ups would never run locally. This starts it with --test-scheduled
// and, each minute, calls /__scheduled for every cron due then, as Cloudflare does on dev and prod.
const port = 8787
const everyMs = 60_000
const crons = wranglerCrons()
const scheduled = (cron: string) => `http://localhost:${port}/__scheduled?cron=${encodeURIComponent(cron)}`

const wrangler = spawn('wrangler', ['dev', '--env', 'local', '--test-scheduled', '--port', String(port), ...process.argv.slice(2)], { stdio: ['inherit', 'pipe', 'inherit'] })

// What the email, SMS and push stand-ins sent (EMAIL_LOCAL, SMS_LOCAL, PUSH_LOCAL): shown here as a block and kept as a file, gitignored.
const mailbox = fileURLToPath(new URL('../../.local-mail/', import.meta.url))
const shown = (m: LocalMessage): string =>
  m.kind === 'email' ? `── email to ${m.to.join(', ')}\n   from ${m.from}\n   ${m.subject}\n\n${m.text}\n──` : `── ${m.kind === 'push' ? 'push' : 'text'} to ${m.to}\n${m.text}\n──`
createInterface({ input: wrangler.stdout }).on('line', (line) => {
  const at = line.indexOf(localMessageMarker)
  if (at === -1) return void console.log(line)
  try {
    const message = JSON.parse(line.slice(at + localMessageMarker.length)) as LocalMessage
    const to = (message.kind === 'email' ? message.to.join('+') : message.to).replace(/[^a-z0-9@.+-]/gi, '_')
    mkdirSync(mailbox, { recursive: true })
    writeFileSync(`${mailbox}${new Date().toISOString().replace(/[:.]/g, '-')}-${message.kind}-${to}.txt`, `${shown(message)}\n`)
    console.log(shown(message))
  } catch {
    console.log(line)
  }
})

let warned = false
const tick = async () => {
  const at = new Date()
  try {
    // Side by side, as Cloudflare starts each due cron as its own run.
    await Promise.all(
      crons
        .filter((cron) => cronDue(cron, at))
        .map(async (cron) => {
          const response = await fetch(scheduled(cron), { signal: AbortSignal.timeout(everyMs - 5_000) })
          if (!response.ok) throw new Error(`answered ${response.status}`)
        }),
    )
    warned = false
  } catch (error) {
    // Once per outage, not every minute: the Worker may still be starting or reloading.
    if (!warned) console.error(`[cron] the scheduled run didn't happen: ${error instanceof Error ? error.message : 'no answer'}`)
    warned = true
  }
}

// Just after each minute starts, so no minute is skipped or run twice.
let timer: NodeJS.Timeout
const next = () => {
  timer = setTimeout(() => {
    void tick()
    next()
  }, everyMs - (Date.now() % everyMs) + 1_000)
}
next()
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => wrangler.kill(signal))
wrangler.on('exit', (code) => {
  clearTimeout(timer)
  process.exit(code ?? 0)
})
