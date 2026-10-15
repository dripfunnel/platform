import type { Person } from '../../../api/settingsPeople'

export type PeopleFilter = 'all' | 'staff' | 'waiting'

export const countsOf = (people: readonly Person[]): { members: number; waiting: number } => ({
  members: people.filter((person) => person.kind === 'member').length,
  waiting: people.filter((person) => person.kind === 'invitation').length,
})

export const peopleShown = (people: readonly Person[], filter: PeopleFilter): readonly Person[] =>
  filter === 'staff' ? people.filter((person) => person.kind === 'member') : filter === 'waiting' ? people.filter((person) => person.kind === 'invitation') : people
