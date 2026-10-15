/** Parts of a muted second line, joined with a middle dot; an empty part is left out. */
export const dotted = (parts: readonly (string | null | undefined | false)[]): string => parts.filter(Boolean).join(' · ')
