import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const protectedBranches = ['main', 'dev']

const branchPattern = /^#([1-9][0-9]*)\/(feature|task|bug)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/
const subjectPattern = /^#([1-9][0-9]*) \S/
const allowedGitSubjects = [/^Merge /, /^(fixup|squash|amend)! #[1-9][0-9]* \S/, /^Revert "#[1-9][0-9]* \S/]

const branchExample = '#12/feature/abandoned-carts'
const subjectExample = '#12 add the abandoned carts list'

export const parseBranch = (name) => {
  const match = branchPattern.exec(name)
  if (!match) return undefined
  return { issue: Number(match[1]), kind: match[2], name: match[3] }
}

export const branchProblem = (name) => {
  if (protectedBranches.includes(name)) return `"${name}" is protected: work on a branch and open a pull request.`
  if (parseBranch(name)) return undefined
  return `Branch "${name}" must be #<issue>/<feature|task|bug>/<short-name>, e.g. ${branchExample}.`
}

export const subjectIssue = (subject) => {
  const match = subjectPattern.exec(subject)
  return match ? Number(match[1]) : undefined
}

export const subjectProblem = (subject) => {
  if (subjectPattern.test(subject) || allowedGitSubjects.some((pattern) => pattern.test(subject))) return undefined
  return `Commit message "${subject}" must start with #<issue> and a space, e.g. "${subjectExample}".`
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const tryGit = (...args) => {
  try {
    return git(...args)
  } catch {
    return undefined
  }
}

export const firstLine = (message, commentChar) =>
  message
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && (commentChar === '#' || !line.startsWith(commentChar))) ?? ''

const fail = (problems) => {
  if (problems.length === 0) return
  for (const problem of problems) console.error(`✖ ${problem}`)
  console.error('\nRules: docs/code/WORKFLOW.md §2.')
  process.exit(1)
}

const commitMsg = (file) => {
  const commentChar = tryGit('config', '--get', 'core.commentChar') ?? '#'
  const problem = subjectProblem(firstLine(readFileSync(file, 'utf8'), commentChar))
  fail(problem ? [problem] : [])
}

const preCommit = () => {
  const branch = tryGit('symbolic-ref', '--quiet', '--short', 'HEAD')
  if (!branch) return
  const problem = branchProblem(branch)
  fail(problem ? [problem] : [])
}

const zero = /^0+$/

const prePush = () => {
  const problems = []
  for (const line of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
    const [, localSha = '', remoteRef = ''] = line.split(' ')
    if (!remoteRef.startsWith('refs/heads/')) continue
    const branch = remoteRef.slice('refs/heads/'.length)
    if (protectedBranches.includes(branch)) problems.push(`Pushing to "${branch}" is not allowed: open a pull request.`)
    else if (!zero.test(localSha)) {
      const problem = branchProblem(branch)
      if (problem) problems.push(problem)
    }
  }
  fail(problems)
}

const fetchIssue = async (issue) => {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${issue}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for issue #${issue}.`)
  return response.json()
}

const checkPullRequest = async () => {
  const { HEAD_REF = '', PR_TITLE = '', BASE_SHA = '', HEAD_SHA = '' } = process.env
  const problems = []
  const branch = parseBranch(HEAD_REF)
  if (!branch) problems.push(branchProblem(HEAD_REF))

  if (subjectProblem(PR_TITLE)) problems.push(`Pull request title "${PR_TITLE}" must start with #<issue> and a space.`)
  else if (branch && subjectIssue(PR_TITLE) !== branch.issue) {
    problems.push(`Pull request title must start with #${branch.issue}, the branch's issue (it becomes the squash commit).`)
  }

  const subjects = git('log', '--format=%s', `${BASE_SHA}..${HEAD_SHA}`).split('\n').filter(Boolean)
  for (const subject of subjects) {
    const problem = subjectProblem(subject)
    if (problem) problems.push(problem)
  }

  const referenced = new Set([branch?.issue, subjectIssue(PR_TITLE), ...subjects.map(subjectIssue)].filter((n) => n !== undefined))
  for (const issue of referenced) {
    const found = await fetchIssue(issue)
    if (!found || found.pull_request) problems.push(`#${issue} is not an issue in this repository.`)
    else if (issue === branch?.issue && found.state !== 'open') problems.push(`Issue #${issue} is closed; the branch must belong to an open issue.`)
  }
  fail(problems)
}

const commands = {
  'commit-msg': () => commitMsg(process.argv[3] ?? ''),
  'pre-commit': preCommit,
  'pre-push': prePush,
  'check-pr': checkPullRequest,
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const command = commands[process.argv[2] ?? '']
  if (!command) {
    console.error(`Usage: naming.mjs <${Object.keys(commands).join('|')}>`)
    process.exit(2)
  }
  await command()
}
