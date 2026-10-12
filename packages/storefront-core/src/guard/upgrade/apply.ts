import { contentPath, cssPath } from '../files.js'
import type { Codemod } from './notes.js'

// The upgrade bot's edits to a store's theme (storefront ARCHITECTURE §7.1), run by the sandbox on the live commit:
// pure functions over the theme's files by path, so the same release gives every store the same edit.

export type ThemeFiles = ReadonlyMap<string, string>
/** A whole file written, or removed when `content` is null. */
export type FileChange = { path: string; content: string | null }

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

const globPattern = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split(/(\*\*\/|\*\*|\*)/)
      .map((part) => (part === '**/' ? '(?:[^/]+/)*' : part === '**' ? '.*' : part === '*' ? '[^/]*' : escape(part)))
      .join('')}$`,
  )

/** The theme after each codemod in order; a codemod that matches nothing changes nothing. */
export const applyCodemods = (theme: ThemeFiles, codemods: readonly Codemod[]): Map<string, string> => {
  const files = new Map(theme)
  for (const mod of codemods) {
    if (mod.kind === 'rename') {
      const text = files.get(mod.from)
      if (text !== undefined && !files.has(mod.to)) {
        files.delete(mod.from)
        files.set(mod.to, text)
      }
      continue
    }
    const patterns = mod.paths.map(globPattern)
    for (const [path, text] of files) {
      if (patterns.some((p) => p.test(path)) && text.includes(mod.find)) files.set(path, text.split(mod.find).join(mod.replace))
    }
  }
  return files
}

/** What turns `before` into `after`, by path order. */
export const changesBetween = (before: ThemeFiles, after: ThemeFiles): FileChange[] =>
  [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((path): FileChange[] => {
      const next = after.get(path)
      if (next === undefined) return [{ path, content: null }]
      return before.get(path) === next ? [] : [{ path, content: next }]
    })

const corePackage = '@dripfunnel/storefront-core'

/** The repo's package.json with core pinned exactly to `version`, which picks the build image (ARCHITECTURE §2.2). */
export const pinCore = (packageJson: string, version: string): string => {
  const pkg: unknown = JSON.parse(packageJson)
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) throw new Error('package.json is not an object')
  const record = pkg as Record<string, unknown>
  const deps = record['dependencies']
  const dependencies = typeof deps === 'object' && deps !== null && !Array.isArray(deps) ? deps : {}
  return `${JSON.stringify({ ...record, dependencies: { ...dependencies, [corePackage]: version } }, null, 2)}\n`
}

type Words = { [key: string]: string | Words }

const isWords = (value: unknown): value is Words => typeof value === 'object' && value !== null && !Array.isArray(value)

const readWords = (text: string | undefined): Words | null => {
  if (text === undefined) return null
  try {
    const value: unknown = JSON.parse(text)
    return isWords(value) ? value : null
  } catch {
    return null
  }
}

/** The baseline's words, each key taking the store's own text where the store's file has the same key. */
const mergeWords = (baseline: Words, own: Words | null): Words =>
  Object.fromEntries(
    Object.entries(baseline).map(([key, value]) => {
      const mine = own?.[key]
      if (typeof value === 'string') return [key, typeof mine === 'string' ? mine : value]
      return [key, mergeWords(value, isWords(mine) ? mine : null)]
    }),
  )

const declaration = /(--[A-Za-z0-9_-]+)(\s*:\s*)([^;{}]+)(;)/g

/** The store's design tokens: each CSS custom property its styles declare, the first declaration winning. */
const tokensOf = (theme: ThemeFiles): Map<string, string> => {
  const tokens = new Map<string, string>()
  for (const [path, text] of theme) {
    if (!cssPath.test(path)) continue
    for (const m of text.matchAll(declaration)) if (m[1] && m[3] && !tokens.has(m[1])) tokens.set(m[1], m[3].trim())
  }
  return tokens
}

/**
 * The baseline theme a store gets when its own can't take a security fix (ARCHITECTURE §7): the baseline's code and
 * styles, every custom property the store also declares set to the store's value (its colours and fonts), and its words
 * in each of the store's languages, the store's own text wherever the store has the same key.
 */
export const baselineWithOwn = (baseline: ThemeFiles, own: ThemeFiles): Map<string, string> => {
  const tokens = tokensOf(own)
  const languageOf = (path: string) => contentPath.exec(path)?.[1]
  const ownLanguages = [...new Set([...own.keys()].flatMap((p) => languageOf(p) ?? []))]
  const baseLanguages = [...new Set([...baseline.keys()].flatMap((p) => languageOf(p) ?? []))]
  const languages = ownLanguages.length > 0 ? ownLanguages : baseLanguages
  const fallback = baseLanguages.includes('en') ? 'en' : baseLanguages[0]
  const files = new Map<string, string>()
  for (const [path, text] of baseline) {
    if (contentPath.test(path)) continue
    files.set(path, cssPath.test(path) ? text.replace(declaration, (whole, name: string, colon: string, _value: string, end: string) => (tokens.has(name) ? `${name}${colon}${tokens.get(name) ?? ''}${end}` : whole)) : text)
  }
  const names = new Set([...baseline.keys()].flatMap((p) => contentPath.exec(p)?.[2] ?? []))
  for (const language of languages) {
    for (const name of names) {
      const base = readWords(baseline.get(`content/${language}/${name}.json`)) ?? readWords(fallback ? baseline.get(`content/${fallback}/${name}.json`) : undefined)
      if (base) files.set(`content/${language}/${name}.json`, `${JSON.stringify(mergeWords(base, readWords(own.get(`content/${language}/${name}.json`))), null, 2)}\n`)
    }
  }
  return files
}
