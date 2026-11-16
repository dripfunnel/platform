import { useId } from 'react'
import type { SampleProblem } from '../../api/storeCategories'
import { fill, formatCount, messages } from '../../messages'

const words = messages.storeCategories.sample

/** What the built-in data's check refused (CATALOG-DESIGN K13a), by line and column; nothing is kept from it. */
export const SampleProblems = ({ problems }: { problems: readonly SampleProblem[] }) => {
  const id = useId()
  if (problems.length === 0) return null
  return (
    <section aria-labelledby={`${id}-problems`} className="df-category-sample-problems">
      <h3 id={`${id}-problems`}>{fill(words.problemsTitle, { count: formatCount(problems.length) })}</h3>
      <ul>
        {problems.map((p, i) => (
          <li key={`${p.line}-${p.column ?? ''}-${p.code}-${i}`}>
            {p.line > 0 ? fill(p.column ? words.problemAtColumn : words.problemAt, { line: formatCount(p.line), column: p.column ?? '' }) : words.problemFile} {p.message}
          </li>
        ))}
      </ul>
    </section>
  )
}
