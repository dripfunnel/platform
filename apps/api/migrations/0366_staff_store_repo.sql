-- A store's repo name for the Admin console's Storefront tab (#935). Staff cannot read `storefront` (restrictive policy,
-- 0064), so one definer function answers one store's repo in platform scope only.
grant select (store_id, repo) on storefront to app_definer;

create function staff_store_repo(p_store uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  select f.repo from storefront f where app_setting_text('app.scope') = 'platform' and f.store_id = p_store
$$;

alter function staff_store_repo(uuid) owner to app_definer;
revoke all on function staff_store_repo(uuid) from public;
grant execute on function staff_store_repo(uuid) to app_platform;
