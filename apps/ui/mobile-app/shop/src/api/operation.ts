import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'

/** A page of a list: what a screen shows, and the cursor of the next page. */
export type Page<Item> = { items: Item[]; next: string | null }

/** One call to the Shop API: what to send, how to read the answer, and the slot its answer is kept in for offline (null: never kept). */
export type Operation<T> = { slot: string | null; signature: string; query: string; variables: Record<string, unknown>; parse: (data: unknown) => T }

export const run = async <T>(client: ApiClient, operation: Operation<T>): Promise<T> => operation.parse(await client.request<unknown>(operation.query, operation.variables))

export const operation = <T>(slot: string | null, query: string, variables: Record<string, unknown>, parse: (data: unknown) => T): Operation<T> => ({ slot, signature: JSON.stringify(variables), query, variables, parse })
