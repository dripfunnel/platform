import { describe, expect, it } from 'vitest'
import { bundleOf, fetchCommitBundle, fetchRequest, maxPackBytes, packOf } from './pack'

const commit = 'c'.repeat(40)
const encoder = new TextEncoder()
const pkt = (bytes: Uint8Array) => {
  const out = new Uint8Array(bytes.length + 4)
  out.set(encoder.encode((bytes.length + 4).toString(16).padStart(4, '0')))
  out.set(bytes, 4)
  return out
}
const line = (text: string) => pkt(encoder.encode(text))
const band = (n: number, data: string) => pkt(new Uint8Array([n, ...encoder.encode(data)]))
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
const flush = encoder.encode('0000')
const text = (bytes: ArrayBuffer | readonly Uint8Array[] | null) => (bytes === null ? null : new TextDecoder().decode(bytes instanceof ArrayBuffer ? bytes : join(...bytes)))
const answering = (body: BodyInit | null, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch

describe('a pushed commit as a bundle', () => {
  it('asks for one commit, with no progress, ending with done', () => {
    expect(fetchRequest(commit)).toBe(`0012command=fetch\n0015agent=dripfunnel\n00010032want ${commit}\n000eofs-delta\n0010no-progress\n0009done\n0000`)
  })

  it('keeps the side band’s pack data in order and skips its progress', () => {
    const answer = join(line('packfile\n'), band(2, 'Counting objects'), band(1, 'PACK'), band(1, '-rest'), flush)
    expect(text(packOf(answer))).toBe('PACK-rest')
  })

  it('refuses an error, a fatal band, no pack, a bad length, and an answer cut short', () => {
    expect(packOf(join(line('ERR upload-pack: not our ref\n'), flush))).toBeNull()
    expect(packOf(join(line('packfile\n'), band(3, 'fatal'), flush))).toBeNull()
    expect(packOf(join(line('packfile\n'), band(1, 'JUNK'), flush))).toBeNull()
    expect(packOf(encoder.encode('00zz'))).toBeNull()
    const whole = join(line('packfile\n'), band(1, 'PACK-and-more'), flush)
    expect(packOf(whole.subarray(0, whole.length - 8))).toBeNull()
    expect(packOf(join(line('packfile\n'), band(1, 'PACK')))).toBeNull()
  })

  it('writes a v2 bundle with main at the commit and no prerequisites', () => {
    expect(text(bundleOf(commit, [encoder.encode('PA'), encoder.encode('CK')]))).toBe(`# v2 git bundle\n${commit} refs/heads/main\n\nPACK`)
  })

  it('posts to the repo’s upload-pack on github.com, null for a repo GitHub doesn’t have', async () => {
    const asked: { url: string; protocol: string | null }[] = []
    const answer = join(line('packfile\n'), band(1, 'PACK'), flush)
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      asked.push({ url, protocol: new Headers(init?.headers).get('git-protocol') })
      return url.includes('sf-missing') ? new Response(null, { status: 404 }) : new Response(answer)
    }) as typeof fetch
    expect(text(await fetchCommitBundle('dripfunnel', 'sf-abcdefghij', commit, fetchImpl))).toBe(`# v2 git bundle\n${commit} refs/heads/main\n\nPACK`)
    expect(asked[0]).toEqual({ url: 'https://github.com/dripfunnel/sf-abcdefghij.git/git-upload-pack', protocol: 'version=2' })
    expect(await fetchCommitBundle('dripfunnel', 'sf-missing', commit, fetchImpl)).toBeNull()
  })

  it('stops reading past the cap, and answers a 5xx or no answer as unavailable for a retry', async () => {
    expect(await fetchCommitBundle('dripfunnel', 'sf-abcdefghij', commit, answering(new Uint8Array(maxPackBytes + 1)))).toBeNull()
    await expect(fetchCommitBundle('dripfunnel', 'sf-abcdefghij', commit, answering(null, 502))).rejects.toThrow('502')
    const silent = (async () => Promise.reject(new TypeError('network'))) as unknown as typeof fetch
    await expect(fetchCommitBundle('dripfunnel', 'sf-abcdefghij', commit, silent)).rejects.toThrow('GitHub did not answer')
  })
})
