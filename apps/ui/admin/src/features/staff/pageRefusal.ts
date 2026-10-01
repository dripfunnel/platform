// A refusal belongs to the page it answered: it outlives the reload after the change, not paging.
export interface PageRefusal {
  text: string
  search: string
}

export const refusalOn = (refusal: PageRefusal | null, search: string): string | null =>
  refusal && refusal.search === search ? refusal.text : null
