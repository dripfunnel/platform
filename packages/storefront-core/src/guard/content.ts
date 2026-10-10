import { brandCopied } from './brand.js'
import { claimsIn } from './claims.js'
import { contentPath } from './files.js'
import { readJson } from './json.js'
import { problem, type GuardContext, type Problem } from './rules.js'

const maxDepth = 4
const keyPattern = /^[A-Za-z0-9_-]{1,64}$/

/** One content file's words by dotted key (`hero.title`), or null when it can't be read. */
type Words = { words: Map<string, string> | null; lineOf: (key: string) => number | null }

const readWords = (file: string, text: string, problems: Problem[]): Words => {
  const json = readJson(file, text)
  if (!json.ok) {
    problems.push(problem(file, json.line, 'content/unreadable', `This file isn't valid JSON: ${json.message}`))
    return { words: null, lineOf: () => json.line }
  }
  const words = new Map<string, string>()
  let readable = true
  const refuse = (path: string[], message: string) => {
    readable = false
    problems.push(problem(file, json.lineOf(path) ?? 1, 'content/unreadable', message))
  }
  const collect = (value: unknown, path: string[]): void => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse(path, 'A content file is an object of words, grouped in objects at most four deep.')
    for (const [key, child] of Object.entries(value)) {
      const at = [...path, key]
      if (!keyPattern.test(key)) refuse(at, `"${key}" isn't a usable key; use letters, digits, - and _.`)
      else if (typeof child === 'string') words.set(at.join('.'), child)
      else if (at.length < maxDepth) collect(child, at)
      else refuse(at, 'Every value is words, grouped at most four objects deep.')
    }
  }
  collect(json.value, [])
  return { words: readable ? words : null, lineOf: (key) => json.lineOf(key.split('.')) }
}

/** The line of a missing key's nearest group in a file that lacks it, else the file's first. */
const nearestLine = (read: Words, key: string): number => {
  const parts = key.split('.')
  for (let depth = parts.length - 1; depth > 0; depth -= 1) {
    const line = read.lineOf(parts.slice(0, depth).join('.'))
    if (line !== null) return line
  }
  return 1
}

/** The content rules of ARCHITECTURE §3.4: every key in every language the store offers, and no invented claim or copied brand field. */
export const checkContent = (files: ReadonlyMap<string, string>, context: GuardContext): Problem[] => {
  const problems: Problem[] = []
  const copied = brandCopied(context.brand)
  const byName = new Map<string, Map<string, Words>>()
  for (const [path, text] of files) {
    const [, locale, name] = contentPath.exec(path) ?? []
    if (locale === undefined || name === undefined) continue
    const read = readWords(path, text, problems)
    for (const [key, words] of read.words ?? []) {
      const line = read.lineOf(key)
      if (words.trim() === '') problems.push(problem(path, line, 'content/missing-key', `"${key}" is empty; write it in ${locale}.`))
      for (const { rule, what } of claimsIn(words)) {
        problems.push(problem(path, line, rule, `"${words}" reads as ${what}. Such facts come only from the store's data through core, never from the theme's words.`))
      }
      const field = copied(words)
      if (field) problems.push(problem(path, line, 'content/brand-literal', `This repeats the store's ${field}. Read it from useStorefront() and pass it to t() as a {value}, so a change in Site settings reaches the site.`))
    }
    const locales = byName.get(name) ?? new Map<string, Words>()
    byName.set(name, locales.set(locale, read))
  }
  for (const [name, locales] of byName) {
    const holder = new Map<string, string>()
    for (const [locale, { words }] of locales) for (const key of words?.keys() ?? []) if (!holder.has(key)) holder.set(key, locale)
    for (const locale of context.locales) {
      const path = `content/${locale}/${name}.json`
      const read = locales.get(locale)
      if (read === undefined) {
        problems.push(problem(path, null, 'content/missing-file', `${path} is missing: the store offers ${locale}, and the theme has ${name}.json in ${[...locales.keys()].join(', ')}.`))
        continue
      }
      for (const [key, other] of holder) {
        if (read.words && !read.words.has(key)) problems.push(problem(path, nearestLine(read, key), 'content/missing-key', `"${key}" is missing, though content/${other}/${name}.json has it; write it in ${locale} too.`))
      }
    }
  }
  return problems
}
