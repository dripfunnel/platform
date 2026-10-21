import { PersonFinder as SharedPersonFinder, type PersonOption } from '@dripfunnel/shared/ui'
import { useCallback } from 'react'
import { findActivityPeople, peopleMinChars } from '../../api/activity'
import { fill, formatCount, messages, plural } from '../../messages'

const words = messages.activity.person
const kinds = messages.activity.personKinds

const finderWords = { label: words.label, placeholder: words.placeholder, hint: words.hint, none: words.none, failed: words.failed, results: (count: number) => fill(plural(words.results, count), { count: formatCount(count) }) }

export interface PersonFinderProps {
  onChoose: (personId: string) => void
}

// FIRST-RELEASE.md §9 and the #44 decision: 2 characters, at most 8 people, each with its email and where.
export const PersonFinder = ({ onChoose }: PersonFinderProps) => {
  const find = useCallback(
    async (query: string): Promise<PersonOption[]> =>
      (await findActivityPeople(query)).map((match) => ({ id: match.id, name: match.name, line: fill(words.optionLine, { email: match.email, where: match.where }), kind: kinds[match.kind] })),
    [],
  )
  return <SharedPersonFinder find={find} minChars={peopleMinChars} words={finderWords} onChoose={(option) => onChoose(option.id)} />
}
