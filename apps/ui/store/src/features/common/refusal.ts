import { isApiError } from '@dripfunnel/shared/graphql'

/** The API's refusal in a screen's words: its message for the code, or its `other` for anything else. */
export const refusalIn =
  (refused: { other: string }) =>
  (error: unknown): string =>
    isApiError(error) ? ((refused as Record<string, string>)[error.code] ?? refused.other) : refused.other
