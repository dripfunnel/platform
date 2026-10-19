import { describe, expect, it, vi } from 'vitest'
import { sandboxImageFor, type SandboxContainer } from './host'

// Card #790: a dev prerelease core has no core_release row, so its image is the one env.dev's containers entry names.
const image = 'registry.cloudflare.com/acct/storefront-build@sha256:' + 'a'.repeat(64)
const released = 'registry.cloudflare.com/acct/storefront-build@sha256:' + 'b'.repeat(64)
const container = (images?: Record<string, string>) => ({ images }) as unknown as SandboxContainer

describe('sandboxImageFor', () => {
  it('gives a dev core the declared studio image without asking core_release', async () => {
    const lookup = vi.fn(async () => released)
    expect(await sandboxImageFor(container({ studio: image }), '0.0.0-dev.8', lookup)).toBe(image)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('gives a released core its core_release image', async () => {
    const lookup = vi.fn(async () => released)
    expect(await sandboxImageFor(container({ studio: image }), '1.4.0', lookup)).toBe(released)
    expect(lookup).toHaveBeenCalledWith('1.4.0')
  })

  it('has no image for a dev core when nothing is declared', async () => {
    expect(await sandboxImageFor(container(), '0.0.0-dev.8', async () => released)).toBeNull()
    expect(await sandboxImageFor(undefined, '0.0.0-dev.8', async () => released)).toBeNull()
  })
})
