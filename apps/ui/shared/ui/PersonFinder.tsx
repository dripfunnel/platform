import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { Tile } from './Tile'
import './activity.css'

// One person a search found, worded by the app: the second line and the kind are its own.
export interface PersonOption {
  id: string
  name: string
  line: string
  kind: string
}

export interface PersonFinderWords {
  label: string
  placeholder: string
  // Under the field while fewer than the minimum characters are typed.
  hint: string
  none: string
  // The search itself failed: never worded as nobody found.
  failed: string
  results: (count: number) => string
}

export interface PersonFinderProps {
  find: (query: string) => Promise<readonly PersonOption[]>
  minChars: number
  words: PersonFinderWords
  onChoose: (option: PersonOption) => void
}

// Admin #44 and partner #192's rule: wait 250 ms after typing stops before searching.
const typingDelayMs = 250

// An ARIA 1.2 combobox. What is typed stays in this field; only the chosen person reaches the app.
export const PersonFinder = ({ find, minChars, words, onChoose }: PersonFinderProps) => {
  const id = useId()
  const listId = `${id}-list`
  const [typed, setTyped] = useState('')
  const [matches, setMatches] = useState<readonly PersonOption[] | null>(null)
  const [active, setActive] = useState(-1)
  const [failed, setFailed] = useState(false)
  const query = typed.trim()

  useEffect(() => {
    setFailed(false)
    if (query.length < minChars) {
      setMatches(null)
      return
    }
    let current = true
    const timer = setTimeout(() => {
      find(query)
        .then((found) => {
          if (!current) return
          setMatches(found)
          setActive(-1)
        })
        .catch(() => {
          if (!current) return
          setMatches(null)
          setFailed(true)
        })
    }, typingDelayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query, find, minChars])

  const open = matches !== null
  const choose = (match: PersonOption) => {
    setTyped('')
    setMatches(null)
    onChoose(match)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open) setMatches(null)
      else setTyped('')
      return
    }
    if (!matches || matches.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index <= 0 ? matches.length - 1 : index - 1))
    } else if (event.key === 'Enter') {
      const match = matches[active]
      if (!match) return
      event.preventDefault()
      choose(match)
    }
  }

  const status = failed ? words.failed : !open ? (query.length > 0 ? words.hint : '') : matches.length === 0 ? words.none : words.results(matches.length)

  return (
    <div className="df-person-finder">
      <label htmlFor={id} className="df-visually-hidden">
        {words.label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder={words.placeholder}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setMatches(null)}
      />
      <ul id={listId} role="listbox" aria-label={words.label} className="df-person-options" hidden={!open || matches.length === 0}>
        {matches?.map((match, index) => (
          <li
            key={match.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? 'df-person-option df-person-option--active' : 'df-person-option'}
            onMouseDown={(event) => {
              event.preventDefault()
              choose(match)
            }}
          >
            <Tile name={match.name} neutral />
            <span className="df-person-option-name">
              <strong>{match.name}</strong>
              <span className="df-muted">{match.line}</span>
            </span>
            <span className="df-muted">{match.kind}</span>
          </li>
        ))}
      </ul>
      <p className="df-visually-hidden" role="status">
        {status}
      </p>
    </div>
  )
}
