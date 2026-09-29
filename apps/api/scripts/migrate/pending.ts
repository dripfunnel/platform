export const pendingMigrations = (files: readonly string[], applied: ReadonlySet<string>): string[] =>
  files
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => !applied.has(name))
