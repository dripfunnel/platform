-- INF 2 (#317): the live pointer, the publish runs and the published versions (DATA-MODEL §7.8, storefront LIVE-SHOP.md §4).
-- Nothing here is destructive: two new tables and three new columns, all empty or defaulted.

-- One row per publish. Its id is the build id: the build's folder is stores/{store}/builds/{id}/ (LIVE-SHOP §4 step 9).
-- INF 4 (#483) adds building and checking, with the gate's report; INF 5 (#484) adds rolled_back.
create table publish_run (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  kind text not null check (kind in ('manual', 'automatic', 'staff', 'design', 'page', 'upgrade', 'security', 'rollback')),
  state text not null default 'queued' check (state in ('queued', 'building', 'checking', 'deploying', 'live', 'failed', 'rolled_back')),
  commit text not null check (commit ~ '^[0-9a-f]{40}$'),
  template text not null check (template ~ '^[a-z0-9-]{1,40}$'),
  core_version text not null check (core_version ~ '^\d+\.\d+\.\d+$'),
  uses_allowance boolean not null default false check (not uses_allowance or kind = 'manual'),
  started_by_kind text not null check (started_by_kind in ('user', 'staff', 'system')),
  started_by_id uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- The build that was live when this one switched: what INF 5's rollback moves back to.
  previous_build_id uuid references publish_run (id),
  error text check (error ~ '^[a-z_]{1,40}$'),
  -- Set once clean-up has deleted the build's folders, source bundle and snapshot (LIVE-SHOP §4 step 11).
  files_deleted_at timestamptz
);
-- One build at a time per store, and one waiting behind it (SAAS §9.1).
create unique index publish_run_one_running on publish_run (store_id) where state in ('building', 'checking', 'deploying');
create unique index publish_run_one_queued on publish_run (store_id) where state = 'queued';
create index publish_run_store_idx on publish_run (store_id, created_at desc);

-- Every publish that went live is a numbered version (SAAS §9.2); build_id is the run that built it.
create table design_version (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  number integer not null check (number > 0),
  commit text not null check (commit ~ '^[0-9a-f]{40}$'),
  template text not null check (template ~ '^[a-z0-9-]{1,40}$'),
  core_version text not null check (core_version ~ '^\d+\.\d+\.\d+$'),
  label text check (char_length(label) <= 200),
  build_id uuid not null references publish_run (id),
  published_by uuid references "user" (id),
  published_at timestamptz not null,
  state text not null check (state in ('live', 'kept')),
  unique (store_id, number)
);
create unique index design_version_one_live on design_version (store_id) where state = 'live';
create index design_version_build_idx on design_version (build_id);

-- The live pointer (LIVE-SHOP §4 step 9) and the number that ends every preview link when moved (PREVIEW §5 step 4).
alter table storefront
  add column live_build_id uuid references publish_run (id),
  add column preview_epoch integer not null default 0 check (preview_epoch >= 0);
alter table design_draft add column base_version_id uuid references design_version (id);

-- Jobs write both; the merchant side reads its own store's, as design_draft (DATA-MODEL §7.8).
grant select on publish_run, design_version to app_request;
grant select, insert, update, delete on publish_run, design_version to app_system;

alter table publish_run enable row level security;
alter table publish_run force row level security;
create policy publish_run_system on publish_run for all to app_system using (true) with check (true);
create policy publish_run_merchant on publish_run for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on publish_run as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on publish_run as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on publish_run as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on publish_run as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

alter table design_version enable row level security;
alter table design_version force row level security;
create policy design_version_system on design_version for all to app_system using (true) with check (true);
create policy design_version_merchant on design_version for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on design_version as restrictive for all to app_request
using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on design_version as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on design_version as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on design_version as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
