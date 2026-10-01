const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" }

// The text a reader gets from server-rendered markup: tags dropped, React's escapes undone.
export const textOf = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => entities[entity] ?? entity)
