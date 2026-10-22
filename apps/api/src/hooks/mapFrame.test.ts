import { describe, expect, it } from 'vitest'
import { handleMapFrame, mapFramePath, mapFrameScriptPath } from './mapFrame'

const key = 'AIzaSyTestTestTestTestTestTestTestTest12'
const get = (path: string, o: { key?: string | null; local?: boolean; method?: string } = {}) =>
  handleMapFrame(new Request(`https://hooks.dripfunnel.com${path}`, { method: o.method ?? 'GET' }), path, { key: o.key === undefined ? key : o.key, local: o.local ?? false })
const directive = (csp: string | null, name: string) => (csp ?? '').split('; ').find((d) => d.startsWith(`${name} `))

describe('the Pin on map frame', () => {
  it('serves the page with the key and its script, under Google’s CSP for this page alone', async () => {
    const page = get(mapFramePath)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await page.text()).toContain(`<script src="${mapFrameScriptPath}" data-key="${key}"></script>`)
    const csp = page.headers.get('content-security-policy')
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-eval' https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com blob:")
    expect(directive(csp, 'default-src')).toBe("default-src 'none'")
    expect(directive(csp, 'form-action')).toBe("form-action 'none'")
    expect(page.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    const script = get(mapFrameScriptPath)
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    const code = await script.text()
    expect(code).toContain('parent.postMessage(message, parentOrigin)')
    expect(code).toContain("'&language=' + language")
    expect(code).toContain('result = placeOf(found.results)')
    expect(code).toContain('...(m.country ? { componentRestrictions: { country: m.country } } : {})')
  })

  it('may be framed by any https store, and by this machine’s http storefront only locally', () => {
    expect(directive(get(mapFramePath).headers.get('content-security-policy'), 'frame-ancestors')).toBe('frame-ancestors https:')
    expect(directive(get(mapFramePath, { local: true }).headers.get('content-security-policy'), 'frame-ancestors')).toBe('frame-ancestors https: http://localhost:* http://127.0.0.1:*')
  })

  it('is not there without a key, or for anything but a GET', () => {
    expect(get(mapFramePath, { key: null }).status).toBe(404)
    expect(get(mapFrameScriptPath, { key: null }).status).toBe(404)
    expect(get(mapFramePath, { method: 'POST' }).status).toBe(404)
  })
})
