-- SAPI 6 (#296), part 2: the reference rates converted prices are computed from (CATALOG fact 26, O5). Platform
-- data, no tenant's: one row per currency, in units per euro as the European Central Bank publishes them, the euro
-- itself being 1. Only the rates job writes it; every store's catalogue reads it.

create table exchange_rate (
  currency char(3) primary key check (currency ~ '^[A-Z]{3}$'),
  per_euro numeric(24, 12) not null check (per_euro > 0),
  source text not null check (source in ('ecb')),
  published_on date not null,
  fetched_at timestamptz not null
);

grant select on exchange_rate to app_request;
grant select, insert, update on exchange_rate to app_system;

alter table exchange_rate enable row level security;
alter table exchange_rate force row level security;
create policy exchange_rate_read on exchange_rate for select to app_request using (true);
create policy exchange_rate_system on exchange_rate for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
-- Every role pinned to its own scopes, as on every table (0010): a shopper's or a store's request reads rates.
create policy request_scope on exchange_rate as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on exchange_rate as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on exchange_rate as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on exchange_rate as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
