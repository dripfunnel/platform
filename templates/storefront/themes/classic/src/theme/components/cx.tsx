/** Joins the class names that are set, skipping false, null and undefined. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')
