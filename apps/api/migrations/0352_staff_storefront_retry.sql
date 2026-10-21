-- Admin Retry of a failed create-storefront job (#730; SAAS §5). Staff cannot touch `storefront` (restrictive policy,
-- 0064), so a staff start goes through two definer functions, each bound to one failed create-storefront job.
grant select on storefront, outbox to app_definer;
grant update (repo, repo_state, repo_head) on storefront to app_definer;

-- The store's repo state, locked, and the template its failed job was started with (read from that job's outbox row).
create function staff_start_row(p_job uuid)
returns table (store_id uuid, partner_id uuid, storefront_kind text, repo text, repo_state text, repo_head text, template text)
language sql
security definer
set search_path = public
as $$
  select s.id, s.partner_id, s.storefront_kind, f.repo, f.repo_state, f.repo_head,
    (select o.payload->>'template' from outbox o where o.kind = 'storefront.create' and o.payload->>'jobId' = j.id::text order by o.created_at desc limit 1)
  from job j join store s on s.id = j.store_id join storefront f on f.store_id = s.id
  where app_setting_text('app.scope') = 'platform' and j.id = p_job and j.kind = 'create-storefront' and j.state = 'failed'
  for update of f
$$;

-- What a new attempt does to the store's repo (`beginStoreRepo`'s first statement), never for a store that has its site.
create function staff_begin_repo(p_job uuid, p_repo text) returns void
language sql
security definer
set search_path = public
as $$
  update storefront f set repo = p_repo, repo_state = 'creating', repo_head = null
  from job j
  where app_setting_text('app.scope') = 'platform' and j.id = p_job and j.kind = 'create-storefront' and j.state = 'failed'
    and f.store_id = j.store_id and f.repo_state <> 'ready'
$$;

alter function staff_start_row(uuid) owner to app_definer;
alter function staff_begin_repo(uuid, text) owner to app_definer;
revoke all on function staff_start_row(uuid), staff_begin_repo(uuid, text) from public;
grant execute on function staff_start_row(uuid), staff_begin_repo(uuid, text) to app_platform;
