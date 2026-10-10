// A toast that outlives the navigation an action ends with (Duplicate opens the copy, Delete goes back to the list):
// set before navigating, shown by the page that opens.
let pending: string | null = null

export const flash = (message: string) => {
  pending = message
}

export const takeFlash = (): string | null => {
  const message = pending
  pending = null
  return message
}
