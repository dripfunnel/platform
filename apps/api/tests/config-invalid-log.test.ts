import { afterEach, expect, it, vi } from 'vitest'
import worker from '../src/index'

// #833: a config the Worker refuses names its keys in the log, never their values.
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext

afterEach(() => vi.restoreAllMocks())

it('logs the invalid key names and no value', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const env = { ADMIN_HOST: 'admin.dripfunnel.ai', PLATFORM_HOST: 'platform.dripfunnel.ai', HOOKS_HOST: 'hooks.dripfunnel.ai', CREDENTIALS_KEK: 'bad-secret-value\n' }
  const response = await worker.fetch(new Request('https://admin.dripfunnel.ai/api/health') as Parameters<typeof worker.fetch>[0], env as never, ctx)
  expect(response.status).toBe(500)
  const line = String(log.mock.calls[0]?.[0])
  expect(JSON.parse(line)).toEqual({ code: 'config_invalid', keys: ['CREDENTIALS_KEK'] })
  expect(line).not.toContain('bad-secret-value')
})
