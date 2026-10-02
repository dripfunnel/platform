// Two plain values hold the same data: the editors' "has anything changed" test (designs/design.md §7).
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
