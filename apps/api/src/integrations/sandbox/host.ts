import { SandboxDown, type SandboxFetch } from './api'

// Where a store's sandbox runs: its own Cloudflare container (AI-STUDIO §1), or, on this machine, `apps/sandbox` started
// by hand as the local stand-in (docs/setup/local.md), one slot per store.

export interface SandboxHost {
  /** Starts the sandbox if it isn't running and waits until it answers. */
  start: () => Promise<void>
  stop: () => Promise<void>
  running: () => boolean
  send: SandboxFetch
}

export const sandboxPort = 8080

/** AI-STUDIO §9: `basic`, given as resources because the durable_object policy's start() takes no `basic` name. */
export const studioInstance = { vcpu: 0.25, memoryMib: 1024, diskMb: 4096 } as const

const ready = async (send: SandboxFetch, sleep: (ms: number) => Promise<void>): Promise<void> => {
  for (let wait = 100; wait <= 6_400; wait *= 2) {
    const ok = await send(new Request('http://sandbox/health', { signal: AbortSignal.timeout(5_000) })).then((r) => r.ok, () => false)
    if (ok) return
    await sleep(wait)
  }
  throw new SandboxDown('The sandbox did not start.')
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The store's container, with no network and no variable but what the image sets (AI-STUDIO §8): `env` is empty on
 * purpose, and `enableInternet` is false. `image` is core_release.sandbox_image, pinned by digest.
 */
/** The parts of a Durable Object's `ctx.container` this host uses, so the type needs no Workers globals. */
export interface SandboxContainer {
  readonly running: boolean
  start(options: { image: string; enableInternet: boolean; env: Record<string, string>; instance: typeof studioInstance }): void
  destroy(): Promise<void>
  getTcpPort(port: number): { fetch(request: Request): Promise<Response> }
}

export const containerHost = (container: SandboxContainer, image: string): SandboxHost => {
  const port = () => container.getTcpPort(sandboxPort)
  const send: SandboxFetch = (request) => port().fetch(request)
  return {
    start: async () => {
      if (!container.running) {
        container.start({ image, enableInternet: false, env: {}, instance: studioInstance })
      }
      await ready(send, sleep)
    },
    stop: async () => {
      if (container.running) await container.destroy()
    },
    running: () => container.running,
    send,
  }
}

/** The local stand-in: `pnpm --filter ./apps/sandbox start:local` on this machine, never a container. */
export const localSandboxHost = (url: string, fetchImpl: typeof fetch = fetch): SandboxHost => {
  let started = false
  const send: SandboxFetch = (request) => {
    const target = new URL(request.url)
    return fetchImpl(new Request(new URL(`${target.pathname}${target.search}`, url), request))
  }
  return {
    start: async () => {
      await ready(send, sleep)
      started = true
    },
    stop: async () => {
      started = false
    },
    running: () => started,
    send,
  }
}
