import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { changesetProblem, coreBump, touchesCore } from './changesets.mjs'

const changeset = (bump, name = '@dripfunnel/storefront-core') => `---\n"${name}": ${bump}\n---\n\nWhy it changed.\n`

describe('touchesCore', () => {
  it('sees a change under packages/storefront-core', () => {
    assert.equal(touchesCore(['packages/storefront-core/src/index.ts']), true)
    assert.equal(touchesCore(['apps/api/src/index.ts', 'docs/README.md']), false)
  })

  it('ignores the changelog the version step writes', () => {
    assert.equal(touchesCore(['packages/storefront-core/CHANGELOG.md']), false)
  })
})

describe('coreBump', () => {
  it('reads the bump for the core package, quoted or not', () => {
    assert.equal(coreBump(changeset('minor')), 'minor')
    assert.equal(coreBump("---\n'@dripfunnel/storefront-core': major\n---\n"), 'major')
    assert.equal(coreBump('---\n@dripfunnel/storefront-core: patch\n---\n'), 'patch')
  })

  it('ignores other packages, bad bumps and text outside the front matter', () => {
    assert.equal(coreBump(changeset('minor', '@dripfunnel/api')), undefined)
    assert.equal(coreBump(changeset('huge')), undefined)
    assert.equal(coreBump('"@dripfunnel/storefront-core": minor\n'), undefined)
  })
})

describe('changesetProblem', () => {
  const core = ['packages/storefront-core/src/index.ts']

  it('passes a pull request that leaves core alone', () => {
    assert.equal(changesetProblem(['apps/api/src/index.ts'], []), undefined)
  })

  it('passes a core change with a changeset naming core', () => {
    assert.equal(changesetProblem(core, [changeset('patch')]), undefined)
  })

  it('refuses a core change without one, or with one for another package', () => {
    assert.match(changesetProblem(core, []), /adds no changeset/)
    assert.match(changesetProblem(core, [changeset('patch', '@dripfunnel/api')]), /adds no changeset/)
  })

  const release = [...core, 'packages/storefront-core/package.json', 'packages/storefront-core/CHANGELOG.md']

  it('passes a release PR: version and changelog moved, and the core changesets it consumed', () => {
    assert.equal(changesetProblem(release, [], { deletedChangesets: [changeset('minor')], versionChanged: true }), undefined)
  })

  it('passes a promotion to main that already holds a release', () => {
    assert.equal(changesetProblem(release, [], { versionChanged: true, intoMain: true }), undefined)
  })

  it('refuses a core change that only deletes an old changeset', () => {
    assert.match(changesetProblem(core, [], { deletedChangesets: [changeset('patch')] }), /adds no changeset/)
  })

  it('refuses a hand-bumped version, even with an edited changelog, outside a release or promotion', () => {
    assert.match(changesetProblem(release, [], { versionChanged: true }), /adds no changeset/)
    assert.match(changesetProblem([...core, 'packages/storefront-core/package.json'], [], { versionChanged: true, intoMain: true }), /adds no changeset/)
  })

  it('still refuses when the consumed changesets name another package', () => {
    assert.match(changesetProblem(release, [], { deletedChangesets: [changeset('patch', '@dripfunnel/api')], versionChanged: true }), /adds no changeset/)
  })
})
