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
  /** The build whose source a store without a draft starts from: its own theme's, while the baseline is served. */
  own_build_id: string | null
  own_core_version: string | null
  /** What a draft moves onto before it publishes (AI-STUDIO §6 step 2): a major's passed upgrade, else the live commit. */
  onto_commit: string | null
  onto_version: string | null
  onto_upgrade: boolean
}

/** What the studio starts from (AI-STUDIO §3 step 4): the draft if there is one, else the live build, else the template. */
export const selectStudioStart = async (tx: ScopedSql, storeId: string): Promise<StudioDraftRow | null> =>
  (
    await tx<StudioDraftRow[]>`
      select d.head_commit, d.template, d.core_version, d.preview_deploy_ref, f.live_build_id,
        s.core_version as store_core_version, f.template as storefront_template,
        o.id as own_build_id, o.core_version as own_core_version,
        coalesce(f.core_upgrade_commit, case when f.theme_mode = 'own' then r.commit end) as onto_commit,
        coalesce(f.core_upgrade_version, case when f.theme_mode = 'own' then r.core_version end) as onto_version,
        f.core_upgrade_commit is not null as onto_upgrade
      from storefront f join store s on s.id = f.store_id left join design_draft d on d.store_id = f.store_id
        left join publish_run r on r.id = f.live_build_id
        left join publish_run o on o.id = case when f.theme_mode = 'baseline' then coalesce(f.baseline_from_build_id, f.live_build_id) else f.live_build_id end
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
      changed_by = excluded.changed_by, preview_deploy_ref = excluded.preview_deploy_ref,
      commits = case when design_draft.head_commit = excluded.head_commit then design_draft.commits else array_append(design_draft.commits, excluded.head_commit) end`
  await tx`update storefront set custom_paths = ${pgArray(d.customPaths)}::text[] where store_id = ${d.storeId}`
}

/** The draft moved onto an upgrade (AI-STUDIO §6 step 2): its new head, on the upgrade's core. */
export const rebaseDraft = async (tx: ScopedSql, d: { storeId: string; head: string; coreVersion: string; at: Date }): Promise<void> => {
  // The replayed changes have new ids, so the bisect chain starts again from the new head (ARCHITECTURE §4.2 step 4).
  await tx`update design_draft set head_commit = ${d.head}, core_version = ${d.coreVersion}, commits = ${pgArray([d.head])}::text[], changed_at = ${d.at} where store_id = ${d.storeId}`
}

/** The partner's live portal host: the only page that may frame the studio (ARCHITECTURE §3.5 `frame-ancestors`). */
export const selectStudioPortalHost = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (
    await tx<{ host: string }[]>`
      select d.host from store s join partner_domain d on d.partner_id = s.partner_id
      where s.id = ${storeId} and d.kind = 'portal' and d.status = 'live' order by d.created_at limit 1`
  )[0]?.host ?? null

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

export type AiRunKind = 'design' | 'repair' | 'migration'
export type AiRunOutcome = 'changed' | 'unchanged' | 'refused' | 'failed'

export interface AiRunInput {
  storeId: string
  kind: AiRunKind
  requestedBy: string | null
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
