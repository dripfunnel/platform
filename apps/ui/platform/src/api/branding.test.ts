import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkContrast, loadBranding, publishBranding, uploadBrandFile } from './branding'
import { northstarBranding } from '../features/branding/brandingTestData'

// Branding's rules are the Platform API's (apps/api tests/platform-branding.test.ts); these check
// how the client reads each answer and the upload route.
const respond = vi.fn<(url: string, init: RequestInit) => Response>()
beforeEach(() => {
  respond.mockReset()
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => Promise.resolve(respond(url, init)))
})
afterEach(() => vi.unstubAllGlobals())

const graphql = (data: unknown) => new Response(JSON.stringify({ data }))
const { look, words } = northstarBranding['partner-owner']
const contrast = { pairs: [{ key: 'primaryOnWhite', ratio: '6.9 : 1', passes: true }, { key: 'accentOnDark', ratio: '9.8 : 1', passes: true }], passes: true, fix: null }

describe('loadBranding', () => {
  it('reads the contract’s Powered-by rule and the permission as the screens use them', async () => {
    respond.mockReturnValue(graphql({ branding: { look, words, affects: 84, contrast, poweredByRule: 'fixedOn', impressumRequired: true, dpaRequired: false, permission: { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' } } }))
    const branding = await loadBranding()
    expect(branding.poweredBy).toEqual({ kind: 'fixedOn' })
    expect(branding.permission).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    expect(branding.impressumRequired).toBe(true)
  })
})

describe('checkContrast and publishBranding', () => {
  it('asks the API for the report with both colours', async () => {
    respond.mockReturnValue(graphql({ checkContrast: contrast }))
    expect(await checkContrast('#0F5E63', '#E8C9A0')).toEqual(contrast)
    expect(JSON.parse(String(respond.mock.calls[0]?.[1].body))).toMatchObject({ variables: { primary: '#0F5E63', accent: '#E8C9A0' } })
  })

  it('reads success, the contrast fix, each refusal, and an unknown one as invalid input', async () => {
    respond.mockReturnValueOnce(graphql({ publishBranding: { ok: true, reason: null, fix: null, field: null } }))
    expect(await publishBranding({ look, words })).toEqual({ ok: true })
    respond.mockReturnValueOnce(graphql({ publishBranding: { ok: false, reason: 'CONTRAST_FAILS', fix: 'try a darker primary', field: null } }))
    expect(await publishBranding({ look, words })).toEqual({ ok: false, reason: 'CONTRAST_FAILS', fix: 'try a darker primary' })
    respond.mockReturnValueOnce(graphql({ publishBranding: { ok: false, reason: 'IMPRESSUM_REQUIRED', fix: null, field: null } }))
    expect(await publishBranding({ look, words })).toEqual({ ok: false, reason: 'IMPRESSUM_REQUIRED' })
    respond.mockReturnValueOnce(graphql({ publishBranding: { ok: false, reason: 'SOMETHING_NEW', fix: null, field: 'look.font' } }))
    expect(await publishBranding({ look, words })).toEqual({ ok: false, reason: 'INVALID_INPUT' })
  })
})

describe('uploadBrandFile', () => {
  const file = new Blob(['<svg/>'], { type: 'image/svg+xml' })

  it('posts the raw file for its slot and reads back the stored key', async () => {
    respond.mockReturnValue(new Response(JSON.stringify({ ok: true, key: 'partners/p1/logoLight-abc.svg' })))
    expect(await uploadBrandFile('logoLight', file)).toEqual({ ok: true, key: 'partners/p1/logoLight-abc.svg' })
    const [url, init] = respond.mock.calls[0] ?? []
    expect(url).toBe('/api/uploads/brand-file?kind=logoLight')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'image/svg+xml' } })
    expect(init?.body).toBe(file)
  })

  it.each(['TOO_LARGE', 'UNSUPPORTED_TYPE', 'UNSAFE_SVG', 'NOT_PNG', 'WRONG_DIMENSIONS', 'HAS_TRANSPARENCY', 'FORBIDDEN', 'UNAUTHENTICATED', 'NOT_CONNECTED'])('passes %s through by its code', async (code) => {
    respond.mockReturnValue(new Response(JSON.stringify({ ok: false, code }), { status: 400 }))
    expect(await uploadBrandFile('mark', file)).toEqual({ ok: false, code })
  })

  it('reads a code it was never promised, a non-JSON answer or no answer as not connected', async () => {
    respond.mockReturnValueOnce(new Response(JSON.stringify({ ok: false, code: 'INVALID_KIND' }), { status: 400 }))
    expect(await uploadBrandFile('mark', file)).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    respond.mockReturnValueOnce(new Response('', { status: 502 }))
    expect(await uploadBrandFile('mark', file)).toEqual({ ok: false, code: 'NOT_CONNECTED' })
    respond.mockImplementationOnce(() => {
      throw new TypeError('Failed to fetch')
    })
    expect(await uploadBrandFile('mark', file)).toEqual({ ok: false, code: 'NOT_CONNECTED' })
  })
})
