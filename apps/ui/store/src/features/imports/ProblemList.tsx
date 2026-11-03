import type { CatalogImport } from '../../api/imports'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.imports.check

/** The problems the API listed, by row and column in plain words, and how many more it didn't send. */
export const ProblemList = ({ problems, count }: { problems: CatalogImport['problems']; count: number }) => {
  const more = count - problems.length
  return (
    <>
      <ul>
        {problems.map((p) => (
          <li key={`${p.line}-${p.column ?? ''}-${p.code}`} className="df-import-fix-row">
            <span className="df-import-mono">{fill(p.file === 'inventory' ? words.inventoryRow : words.row, { line: String(p.line) })}</span>
            <span className="df-import-mono">{p.column ?? words.file}</span>
            <span>{p.message}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="df-import-hint">{fill(plural(words.moreProblems, more), { count: formatCount(more) })}</p>}
    </>
  )
}
