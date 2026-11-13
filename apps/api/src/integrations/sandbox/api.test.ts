import { describe, expect, it } from 'vitest'
import type { GuardContext } from '@dripfunnel/storefront-core/guard'
import { sandboxClient } from './api'

const context: GuardContext = { locales: ['en'], usedPaths: [], mediaIds: [], brand: { name: 'Kesari', tagline: null, email: null, phone: null, address: [], socialLinks: [] } }

describe('the commit message the sandbox is sent', () => {
  it('is the request cut to the sandbox’s 2,000 characters, never splitting a character', async () => {
    const sent: { message: string }[] = []
    const client = sandboxClient(async (request) => {
      sent.push((await request.json()) as { message: string })
      return Response.json({ ok: false, problems: [] })
    }, 'slot-1')
    await client.change([], `${'a'.repeat(1999)}😀 and the rest of a long brief`, context)
    await client.undo('a'.repeat(40), 'Undo', context)
    expect(sent.map((s) => s.message)).toEqual(['a'.repeat(1999), 'Undo'])
  })
})

describe('a picture of a page', () => {
  it('is the sandbox’s answer, and none at all from a sandbox image that has no picture to give', async () => {
    const asked: string[] = []
    const answering = sandboxClient(async (request) => (asked.push(new URL(request.url).pathname), Response.json({ images: ['AA=='], problem: null })), 'slot-1')
    expect(await answering.picture([{ path: 'src/theme/styles/theme.css', content: 'x' }], 'home', 'desktop', context)).toEqual({ images: ['AA=='], problem: null })
    expect(asked).toEqual(['/slots/slot-1/picture'])
    const older = sandboxClient(async () => Response.json({ error: 'Not found.' }, { status: 404 }), 'slot-1')
    expect(await older.picture([], 'home', 'desktop', context)).toBeNull()
  })
})

