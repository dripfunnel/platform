-- SAPI 17b (#471), part 2: a merchant's own domain from the Store API (SAAS §8; DATA-MODEL §7.2): made primary, which
-- the other addresses redirect to, or removed. Nothing here is destructive: a column, a policy and a function.

alter table custom_domain add column is_primary boolean not null default false;
-- Until now a live domain was the store's main address (SAAS §8); it stays so, and a domain going live from here on
-- becomes primary only when the Owner makes it so (PortalStorefront).
update custom_domain set is_primary = true where status in ('live', 'expiring', 'broken');

-- The merchant side removes its own domain; the activity log keeps its history (custom_domain.removed).
grant delete on custom_domain to app_request;
create policy custom_domain_delete on custom_domain for delete to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');

-- Whether a host is already another store's domain, or a partner's address or under one (a store's free address is
-- `{code}.shops.<partnerdomain>`): neither may be connected, since the edge would then answer it for two stores.
create function merchant_host_taken(p_host text) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from custom_domain c where lower(c.host) = lower(p_host) and c.store_id is distinct from app_setting_uuid('app.store_id')
  ) or exists (
    select 1 from partner_domain d
    where lower(p_host) = lower(replace(d.host, '*.', '')) or right(lower(p_host), length(replace(d.host, '*.', '')) + 1) = '.' || lower(replace(d.host, '*.', ''))
  )
$$;
alter function merchant_host_taken(text) owner to app_definer;
revoke all on function merchant_host_taken(text) from public;
grant execute on function merchant_host_taken(text) to app_request;
grant select (host, store_id) on custom_domain to app_definer;
grant select (host) on partner_domain to app_definer;
