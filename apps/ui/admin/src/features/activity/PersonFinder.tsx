import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { findActivityPeople, peopleMinChars, type PersonMatch } from '../../api/activity'
import { fill, formatCount, messages, plural } from '../../messages'
import { Tile } from '@dripfunnel/shared/ui'
import './activityLog.css'

const words = messages.activity.person
const kinds = messages.activity.personKinds

// FIRST-RELEASE.md §9 and the #44 decision: 2 characters, 250 ms, at most 8 people.
const typingDelayMs = 250

export interface PersonFinderProps {
  onChoose: (personId: string) => void
}

// An ARIA 1.2 combobox. What is typed stays in this field; only the chosen person's id reaches the URL.
export const PersonFinder = ({ onChoose }: PersonFinderProps) => {
  const id = useId()
  const listId = `${id}-list`
  const [typed, setTyped] = useState('')
  const [matches, setMatches] = useState<readonly PersonMatch[] | null>(null)
  const [active, setActive] = useState(-1)
  const query = typed.trim()

  useEffect(() => {
    if (query.length < peopleMinChars) {
      setMatches(null)
      return
    }
    let current = true
    const timer = setTimeout(() => {
      findActivityPeople(query)
        .then((found) => {
          if (!current) return
          setMatches(found)
          setActive(-1)
        })
        .catch(() => current && setMatches([]))
    }, typingDelayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  const open = matches !== null
  const choose = (match: PersonMatch) => {
    setTyped('')
    setMatches(null)
    onChoose(match.id)
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

  const status = !open ? (query.length > 0 ? words.hint : '') : matches.length === 0 ? words.none : fill(plural(words.results, matches.length), { count: formatCount(matches.length) })

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
              <span className="df-muted">{fill(words.optionLine, { email: match.email, where: match.where })}</span>
            </span>
            <span className="df-muted">{kinds[match.kind]}</span>
          </li>
        ))}
      </ul>
      <p className="df-visually-hidden" role="status">
        {status}
      </p>
    </div>
  )
}
