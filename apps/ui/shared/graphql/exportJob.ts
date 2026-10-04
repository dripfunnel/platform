export type ExportState = 'preparing' | 'ready' | 'expired' | 'tooLarge' | 'failed'

// An export is a job (FIRST-RELEASE §16; admin #44): prepared out of the request, then a link that expires.
export interface ExportJob {
  id: string
  state: ExportState
  entries: number | null
  url: string | null
  expiresAt: string | null
  // Only the first `entries` rows: the export hit the API's cap (platform FIRST-RELEASE §16).
  truncated?: boolean
}
