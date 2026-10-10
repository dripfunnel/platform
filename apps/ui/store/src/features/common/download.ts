/** Saves text the API answered (a template, a problems file) as a CSV, named for the person's disk. */
export const downloadCsv = (csv: string, name: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
