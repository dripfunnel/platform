import { pgArray, type ScopedSql } from './index'

// The studio's rows (DATA-MODEL §7.8; storefront AI-STUDIO.md): its sessions, its draft and its AI runs, in system
// scope. The Durable Object and the studio service reach a store's rows only by the id the session's TenantContext gave.

export interface StudioDraftRow {
  head_commit: string | null
  template: string | null
  core_version: string | null
  preview_deploy_ref: string | null
  live_build_id: string | null
  store_core_version: string | null
  storefront_template: string | null
}

/** What the studio starts from (AI-STUDIO §3 step 4): the draft if there is one, else the live build, else the template. */
export const selectStudioStart = async (tx: ScopedSql, storeId: string): Promise<StudioDraftRow | null> =>
  (
    await tx<StudioDraftRow[]>`
      select d.head_commit, d.template, d.core_version, d.preview_deploy_ref, f.live_build_id,
        s.core_version as store_core_version, f.template as storefront_template
      from storefront f join store s on s.id = f.store_id left join design_draft d on d.store_id = f.store_id
      where f.store_id = ${storeId}`
  )[0] ?? null

/** An accepted change moves the draft's head and its preview together (AI-STUDIO §4 steps 6–7, PREVIEW §4 step 3). */
export const moveDraft = async (
  tx: ScopedSql,
  d: { storeId: string; head: string; template: string; coreVersion: string; previewRef: string; userId: string; at: Date; customPaths: readonly string[] },
): Promise<void> => {
  await tx`
    insert into design_draft (store_id, head_commit, template, core_version, changed_at, changed_by, preview_deploy_ref)
    values (${d.storeId}, ${d.head}, ${d.template}, ${d.coreVersion}, ${d.at}, ${d.userId}, ${d.previewRef})
    on conflict (store_id) do update set head_commit = excluded.head_commit, changed_at = excluded.changed_at,
      changed_by = excluded.changed_by, preview_deploy_ref = excluded.preview_deploy_ref`
  await tx`update storefront set custom_paths = ${pgArray(d.customPaths)}::text[] where store_id = ${d.storeId}`
}

export interface GuardContextRow {
  name: string
  main_language: string
  languages: string[]
  media_ids: string[]
}

/** The validator's context from the platform (storefront ARCHITECTURE §3.4), so the sandbox needs no network. */
export const selectGuardContext = async (tx: ScopedSql, storeId: string): Promise<GuardContextRow | null> =>
  (
    await tx<GuardContextRow[]>`
      select s.name, s.main_language,
        coalesce((select json_agg(l.language order by l.language) from store_language l where l.store_id = s.id and l.status = 'active'), '[]'::json) as languages,
        coalesce((select json_agg(a.id::text) from (select id from asset where store_id = s.id and seller_id is null and kind = 'image'
          order by created_at desc limit 10000) a), '[]'::json) as media_ids
      from store s where s.id = ${storeId}`
  )[0] ?? null

export type AiRunKind = 'design' | 'repair'
export type AiRunOutcome = 'changed' | 'unchanged' | 'refused' | 'failed'

export interface AiRunInput {
  storeId: string
  kind: AiRunKind
  requestedBy: string
  prompt: string
  model: string
  tokensIn: number
  tokensOut: number
  costAmount: number
  costCurrency: string
  billedTo: 'plan' | 'own_key' | 'platform'
  sandboxMs: number
  repairAttempts: number
  parentRunId: string | null
  outcome: AiRunOutcome
}

export const insertAiRun = async (tx: ScopedSql, r: AiRunInput): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into ai_run (store_id, kind, requested_by, prompt, model, tokens_in, tokens_out, cost_amount, cost_currency, billed_to,
      sandbox_ms, repair_attempts, parent_run_id, outcome)
    values (${r.storeId}, ${r.kind}, ${r.requestedBy}, ${r.prompt}, ${r.model}, ${r.tokensIn}, ${r.tokensOut}, ${r.costAmount},
      ${r.costCurrency}, ${r.billedTo}, ${r.sandboxMs}, ${r.repairAttempts}, ${r.parentRunId}, ${r.outcome})
    returning id`
  if (!row) throw new Error('ai_run: insert returned nothing')
  return row.id
}

export interface StudioSessionRow {
  user_id: string
  can_change: boolean
}

export const insertStudioSession = async (
  tx: ScopedSql,
  s: { idHash: string; storeId: string; userId: string; userSessionHash: string; canChange: boolean; at: Date; expiresAt: Date },
): Promise<void> => {
  await tx`delete from studio_session where store_id = ${s.storeId} and expires_at <= ${s.at}`
  await tx`
    insert into studio_session (id_hash, store_id, user_id, user_session_hash, can_change, created_at, expires_at)
    values (${s.idHash}, ${s.storeId}, ${s.userId}, ${s.userSessionHash}, ${s.canChange}, ${s.at}, ${s.expiresAt})`
}

/** How long a portal session may sit idle (ACCESS §4), given by the caller: auth/storeSession owns the numbers. */
export type PortalIdle = { idleMs: number; rememberIdleMs: number }

/**
 * Live: unexpired, for this store, and its portal session still signed in by readUserSession's own test (AI-STUDIO §8
 * "Bound"): a full session, inside its absolute and idle bounds. The idle window isn't slid here: only the portal does.
 */
export const selectLiveStudioSession = async (tx: ScopedSql, storeId: string, idHash: string, at: Date, portal: PortalIdle): Promise<StudioSessionRow | null> =>
  (
    await tx<StudioSessionRow[]>`
      select t.user_id, t.can_change from studio_session t join user_session u on u.id_hash = t.user_session_hash
      where t.id_hash = ${idHash} and t.store_id = ${storeId} and t.expires_at > ${at}
        and u.stage = 'full' and u.absolute_expires_at > ${at}
        and u.last_seen_at > ${at}::timestamptz - case when u.remember then ${`${portal.rememberIdleMs} milliseconds`}::interval else ${`${portal.idleMs} milliseconds`}::interval end`
  )[0] ?? null

/** Renewed only for the user and portal session that opened it, with the access the re-check just found. */
export const renewStudioSession = async (
  tx: ScopedSql,
  s: { idHash: string; storeId: string; userId: string; userSessionHash: string; canChange: boolean; at: Date; expiresAt: Date },
): Promise<boolean> =>
  (
    await tx`
      update studio_session set expires_at = ${s.expiresAt}, can_change = ${s.canChange}
      where id_hash = ${s.idHash} and store_id = ${s.storeId} and user_id = ${s.userId} and user_session_hash = ${s.userSessionHash}
        and expires_at > ${s.at}`
  ).count === 1

export const deleteStudioSession = async (tx: ScopedSql, storeId: string, idHash: string): Promise<void> => {
  await tx`delete from studio_session where id_hash = ${idHash} and store_id = ${storeId}`
}
