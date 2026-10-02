import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { branchProblem, firstLine, parseBranch, subjectIssue, subjectProblem } from './naming.mjs'

describe('parseBranch', () => {
  it('reads <issue>/<kind>/<short-name>', () => {
    assert.deepEqual(parseBranch('12/feature/abandoned-carts'), { issue: 12, kind: 'feature', name: 'abandoned-carts' })
    assert.deepEqual(parseBranch('7/task/db-foundation'), { issue: 7, kind: 'task', name: 'db-foundation' })
    assert.deepEqual(parseBranch('300/bug/money-rounding'), { issue: 300, kind: 'bug', name: 'money-rounding' })
  })

  it('refuses anything else', () => {
    for (const name of ['feature/offers', '#12/feature/offers', '12-feature-offers', '0/task/x', '12/chore/x', '12/feature/Offers', '12/feature/a/b', '12/feature/', '12/bug/-x', 'main']) {
      assert.equal(parseBranch(name), undefined, name)
    }
  })
})

describe('branchProblem', () => {
  it('protects main and dev', () => {
    assert.match(branchProblem('main'), /protected/)
    assert.match(branchProblem('dev'), /protected/)
  })

  it('explains the format', () => {
    assert.match(branchProblem('fix-login'), /<issue>\/<feature\|task\|bug>\/<short-name>/)
    assert.equal(branchProblem('12/bug/login-loop'), undefined)
    assert.ok(branchProblem('#12/bug/login-loop'))
  })
})

describe('subjectProblem', () => {
  it('accepts #<issue> and a space, then the message', () => {
    assert.equal(subjectProblem('#12 add the abandoned carts list'), undefined)
    assert.equal(subjectIssue('#12 add the abandoned carts list'), 12)
  })

  it('accepts the subjects git writes itself', () => {
    for (const subject of ["Merge branch 'main' into 12/feature/offers", 'fixup! #12 add list', 'squash! #12 add list', 'Revert "#12 add list"']) {
      assert.equal(subjectProblem(subject), undefined, subject)
    }
  })

  it('refuses anything else', () => {
    for (const subject of ['add list', '#12add list', '#12', '# 12 add list', 'docs: #12 add list', '#0 add list']) {
      assert.ok(subjectProblem(subject), subject)
    }
  })
})

describe('firstLine', () => {
  it('skips comment lines when the comment character is not #', () => {
    assert.equal(firstLine('; Please enter a message\n\n#12 add list\n\nbody', ';'), '#12 add list')
  })

  it('keeps # lines when # is the comment character', () => {
    assert.equal(firstLine('#12 add list\n', '#'), '#12 add list')
  })
})
