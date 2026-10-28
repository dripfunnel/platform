-- SH 15 (#868): a store's mobile apps' icon, splash and listing text, which a build reads (mobile-app/README.md §3; DATA-MODEL §2.5's
-- partner_branding is the pattern). Versioned, append-only: a save adds a version, and none is ever changed or deleted.
-- The files are R2 object keys, never a URL; null until uploaded. No seller or partner branch: neither reads these.

create table store_app_assets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  version integer not null check (version >= 1),
  app_icon_key text,
  app_icon_foreground_key text,
  splash_key text,
  app_name text check (char_length(app_name) between 1 and 30),
  short_description text check (char_length(short_description) between 1 and 80),
  long_description text check (char_length(long_description) between 1 and 4000),
  created_by_user_id uuid references "user" (id),
  created_at timestamptz not null default now(),
  unique (store_id, version)
);

-- The build (system scope) reads the newest; the Owner's Settings › Mobile apps reads the history and adds a version. Nobody updates or deletes.
grant select on store_app_assets to app_system;
grant select on store_app_assets to app_request;
grant insert (store_id, version, app_icon_key, app_icon_foreground_key, splash_key, app_name, short_description, long_description, created_by_user_id) on store_app_assets to app_request;

alter table store_app_assets enable row level security;
alter table store_app_assets force row level security;
create policy store_app_assets_system on store_app_assets for select to app_system using (true);
create policy request_scope on store_app_assets as restrictive for all to app_request
  using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on store_app_assets as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on store_app_assets as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on store_app_assets as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

create policy store_app_assets_merchant_select on store_app_assets for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy store_app_assets_merchant_insert on store_app_assets for insert to app_request
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
