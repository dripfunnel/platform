// The sandbox holds no credential (storefront AI-STUDIO §1, §8): it refuses to start when its environment carries one,
// and every program it runs gets only these variables.
const secretName = /TOKEN|SECRET|PASSW|CREDENTIAL|PRIVATE|API_?KEY|_KEY$|_PAT$|^PAT$|AUTH|DATABASE_URL|COOKIE|SESSION/i

/** The names that look like a credential; the sandbox exits when there is any (AGENTS.md "Security"). */
export const secretLikeNames = (env: NodeJS.ProcessEnv): string[] => Object.keys(env).filter((k) => secretName.test(k))

/** What git and every other program the gate runs sees: a path, a home of its own, and nothing inherited. */
export const childEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
  HOME: home,
  LANG: 'C.UTF-8',
})

export const sandboxConfig = (env: NodeJS.ProcessEnv) => {
  const port = Number(env['PORT'] ?? '8080')
  const slots = Number(env['SANDBOX_SLOTS'] ?? '1')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a port number.')
  if (!Number.isInteger(slots) || slots < 1 || slots > 100) throw new Error('SANDBOX_SLOTS must be 1 to 100.')
  return { port, slots, workRoot: env['SANDBOX_WORK'] ?? '/tmp/sandbox', runtimeDir: env['SANDBOX_RUNTIME'] ?? null }
}
