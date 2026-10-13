/** Only a not-found line naming this very image counts: any other failure (an account, a token) is retried, never recorded. */
export const imageMissing = (stderr: string, version: string): boolean =>
  stderr.split('\n').some((line) => line.includes(`storefront-build:${version}`) && /\b(not found|does not exist)\b/i.test(line))

export interface DeleteSteps {
  /** Deletes `storefront-build:{version}`; throws with wrangler's stderr when it fails. */
  remove: (version: string) => Promise<void>
  markDeleted: (version: string) => Promise<void>
}

/**
 * Each retired version's image goes on its own, so one failure never holds back the rest (AI-STUDIO §9); an image
 * already gone counts as deleted, so a run that deleted it but failed to record it isn't stuck on it every day.
 */
export const deleteRetiredImages = async (versions: readonly string[], steps: DeleteSteps): Promise<{ deleted: string[]; failed: string[] }> => {
  const deleted: string[] = []
  const failed: string[] = []
  for (const version of versions) {
    try {
      await steps.remove(version).catch((error: unknown) => {
        if (!imageMissing(stderrOf(error), version)) throw error
      })
      await steps.markDeleted(version)
      deleted.push(version)
    } catch {
      failed.push(version)
    }
  }
  return { deleted, failed }
}

export const stderrOf = (error: unknown): string => {
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  return typeof stderr === 'string' ? stderr : ''
}
