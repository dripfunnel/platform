import { describe, expect, it, vi } from 'vitest'

vi.mock('../harness', () => ({ harnessEnabled: false }))

describe('the harness sample', () => {
  it('is inert outside a harness build: no seat, no partner look', async () => {
    const { brandSample, shellSample } = await import('./sample')
    expect(shellSample({ as: 'owner', store: 'trial' })).toBeNull()
    expect(brandSample(new URLSearchParams('brand=partner'))).toBeNull()
  })
})
