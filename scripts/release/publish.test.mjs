import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { publishedVersion, releasable, releaseCommit, tagFor } from './publish.mjs'

describe('tagFor', () => {
  it('names the tag the way changesets does', () => {
    assert.equal(tagFor('1.4.0'), '@dripfunnel/storefront-core@1.4.0')
  })
})

describe('publishedVersion', () => {
  it('reads the version npm answers', () => {
    assert.equal(publishedVersion({ ok: true, stdout: '"1.4.0"\n', stderr: '' }), '1.4.0')
  })

  it('treats a 404 as not published', () => {
    assert.equal(publishedVersion({ ok: false, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' }), null)
  })

  it('throws on any other failure, so an auth or network error never looks like "not published"', () => {
    assert.throws(() => publishedVersion({ ok: false, stdout: '', stderr: 'npm error code E401' }), /npm view failed/)
  })
})

describe('releasable', () => {
  it('never releases 0.0.0, the version before any release card', () => {
    assert.equal(releasable('0.0.0'), false)
    assert.equal(releasable('0.1.0'), true)
  })
})

describe('releaseCommit', () => {
  it('finds the commit that changed the version, not a later edit near the version line', () => {
    const history = [
      { sha: 'later', version: '1.1.0', parentVersion: '1.1.0' },
      { sha: 'release', version: '1.1.0', parentVersion: '1.0.0' },
      { sha: 'older', version: '1.0.0', parentVersion: '0.0.0' },
    ]
    assert.equal(releaseCommit(history, '1.1.0'), 'release')
    assert.equal(releaseCommit(history, '2.0.0'), undefined)
  })
})
