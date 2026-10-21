-- SAPI 20 (#330), part 2: private apps (PLATFORM-PROMPT §5.5; ACCESS §5.6; DATA-MODEL §7.10). Staff register an app;
-- an Owner installs it with consent to its scopes, which makes a grant whose token is kept only as its SHA-256 and sent
-- once to the app's own address, signed with the app's secret.

create table app (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  developer text not null check (length(developer) between 1 and 120),
  site_url text not null check (site_url ~ '^https://' and length(site_url) <= 2000),
  webhook_url text not null check (webhook_url ~ '^https://' and length(webhook_url) <= 2000),
  scopes text[] not null check (cardinality(scopes) between 1 and 40),
  secret_sealed text not null,
  status text not null default 'live' check (status in ('live', 'suspended')),
  created_by_staff_id uuid not null,
  created_at timestamptz(3) not null default now(),
  updated_at timestamptz(3) not null default now()
);

create table app_grant (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  app_id uuid not null references app (id),
  scopes text[] not null check (cardinality(scopes) between 1 and 40),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  installed_by_user_id uuid not null references "user" (id),
  installed_at timestamptz(3) not null default now(),
  last_used_at timestamptz(3),
  revoked_at timestamptz(3),
  revoked_by_user_id uuid references "user" (id)
);

create unique index app_grant_token_key on app_grant (token_hash);
-- One live install of an app per store, so two installs at once can't both grant it.
create unique index app_grant_live_key on app_grant (store_id, app_id) where revoked_at is null;
create index app_grant_store_idx on app_grant (store_id, installed_at desc, id desc) where revoked_at is null;

-- Staff manage the registry; a store reads a live app's public face for the consent screen; the relay reads the rest.
grant select (id, name, developer, site_url, webhook_url, scopes, status, created_by_staff_id, created_at, updated_at), insert on app to app_platform;
grant update (name, developer, site_url, webhook_url, scopes, status, updated_at) on app to app_platform;
grant select (id, name, developer, site_url, scopes, status) on app to app_request;
grant select on app to app_system;
grant select (id, store_id, app_id, scopes, installed_by_user_id, installed_at, last_used_at, revoked_at, revoked_by_user_id), insert on app_grant to app_request;
grant update (revoked_at, revoked_by_user_id) on app_grant to app_request;
grant select, update (last_used_at) on app_grant to app_system;

alter table app enable row level security;
alter table app force row level security;
create policy app_platform_all on app for all to app_platform using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy app_store_read on app for select to app_request using (app_setting_text('app.scope') = 'store' and status = 'live');
create policy app_system on app for select to app_system using (true);
create policy request_scope on app as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on app as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on app as restrictive for all to app_platform
using (app_setting_text('app.scope') = 'platform') with check (app_setting_text('app.scope') = 'platform');
create policy system_scope on app as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

alter table app_grant enable row level security;
alter table app_grant force row level security;
create policy app_grant_system on app_grant for all to app_system using (true) with check (true);
create policy app_grant_store on app_grant for all to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'));
create policy request_scope on app_grant as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on app_grant as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on app_grant as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on app_grant as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on app_grant as restrictive for insert to app_request with check (app_setting_text('app.support') = '');
create policy support_no_update on app_grant as restrictive for update to app_request with check (app_setting_text('app.support') = '');
