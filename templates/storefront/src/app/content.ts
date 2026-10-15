import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
type Words = Record<string, string>

const flatten = (value: unknown, prefix: string, into: Words): void => {
  if (typeof value === 'string') into[prefix] = value
  else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) flatten(inner, `${prefix}.${key}`, into)
}

/** content/{language}/{file}.json as flat `file.key` words, the shape the sandbox's bundle hands core (gate/bundle.ts). */
export const readContent = (root = join(process.cwd(), 'content')): Record<string, Words> =>
  Object.fromEntries(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const words: Words = {}
        for (const file of readdirSync(join(root, entry.name)).filter((f) => f.endsWith('.json')))
          flatten(JSON.parse(readFileSync(join(root, entry.name, file), 'utf8')), file.slice(0, -'.json'.length), words)
        return [entry.name, words]
      }),
  )
