// A side effect waiting for delivery (api/README.md §5; migrations/0006).
export interface OutboxRow {
  id: string
  created_at: Date
  kind: string
  idempotency_key: string
  payload: unknown
  partner_id: string | null
  store_id: string | null
  attempts: number
  next_attempt_at: Date
  claimed_at: Date | null
  delivered_at: Date | null
  failed_at: Date | null
  last_error: string | null
}

export interface NewOutboxRow {
  kind: string
  idempotencyKey: string
  payload: Record<string, unknown>
  partnerId: string | null
  storeId: string | null
}
