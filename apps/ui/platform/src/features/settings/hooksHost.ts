/** The hooks host of the environment a console host belongs to: `platform.x` → `hooks.x`, `dev-platform.x` → `dev-hooks.x`; locally `hooks.localhost` (docs/setup/local.md §6.3). */
export const hooksHostFor = (hostname: string): string => {
  const host = hostname.toLowerCase()
  const swapped = host.replace(/^([^.]*?)platform(?=\.)/, '$1hooks')
  return swapped !== host ? swapped : 'hooks.localhost'
}
