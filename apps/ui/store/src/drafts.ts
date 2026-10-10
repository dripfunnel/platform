// Unsaved work kept in this tab's session storage, under one prefix, so signing out forgets it all (a shared device).
export const draftPrefix = 'df-draft:'

export const forgetDrafts = (): void => {
  if (typeof sessionStorage === 'undefined') return
  for (const key of Object.keys(sessionStorage)) if (key.startsWith(draftPrefix)) sessionStorage.removeItem(key)
}
