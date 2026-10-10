-- SAPI 20 (#330), part 1: the store's API keys (ACCESS §5.6; DATA-MODEL §3.5, §7.10). The secret is shown once and
-- kept only as its SHA-256; the prefix names it in the list. A rotation is a new row naming the one it replaces,
-- whose secret keeps working a day (superseded_at, with its expiry brought forward to then).

create table api_key (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  seller_id uuid,
  name text not null check (length(name) between 1 and 80),
  prefix text not null check (prefix ~ '^dfk_[0-9A-Za-z]{8}$'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 40),
  created_by_user_id uuid not null references "user" (id),
  created_at timestamptz(3) not null default now(),
  expires_at timestamptz(3),
  last_used_at timestamptz(3),
  revoked_at timestamptz(3),
  revoked_by_user_id uuid references "user" (id),
  rotated_from_id uuid references api_key (id),
  superseded_at timestamptz(3),
  foreign key (seller_id, store_id) references seller (id, store_id)
);

create unique index api_key_secret_key on api_key (secret_hash);
-- One successor per key, so two rotations at once can't both mint one.
create unique index api_key_rotated_from_key on api_key (rotated_from_id) where rotated_from_id is not null;
create index api_key_store_idx on api_key (store_id, created_at desc, id desc) where revoked_at is null;
create index api_key_creator_idx on api_key (store_id, created_by_user_id) where revoked_at is null;

-- The merchant side lists, creates, rotates and revokes, never reading the hash; resolution and "last used" are app_system's.
grant select (id, store_id, seller_id, name, prefix, scopes, created_by_user_id, created_at, expires_at, last_used_at, revoked_at, revoked_by_user_id, rotated_from_id, superseded_at)
  on api_key to app_request;
grant insert on api_key to app_request;
grant update (expires_at, revoked_at, revoked_by_user_id, superseded_at) on api_key to app_request;
grant select, update (last_used_at) on api_key to app_system;

alter table api_key enable row level security;
alter table api_key force row level security;
create policy api_key_system on api_key for all to app_system using (true) with check (true);
create policy api_key_store on api_key for all to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'));
create policy request_scope on api_key as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on api_key as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on api_key as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on api_key as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on api_key as restrictive for insert to app_request with check (app_setting_text('app.support') = '');
create policy support_no_update on api_key as restrictive for update to app_request with check (app_setting_text('app.support') = '');

-- Per plan, per store (decided on #337): this minute's and this month's calls by keys and apps, counted where they're resolved.
create table api_usage (
  store_id uuid primary key references store (id),
  minute_start timestamptz(0) not null,
  minute_used integer not null check (minute_used >= 0),
  month_start date not null,
  month_used integer not null check (month_used >= 0)
);

grant select, insert, update on api_usage to app_system;
grant select on api_usage to app_request;

alter table api_usage enable row level security;
alter table api_usage force row level security;
create policy api_usage_system on api_usage for all to app_system using (true) with check (true);
create policy api_usage_store on api_usage for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'));
create policy request_scope on api_usage as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on api_usage as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on api_usage as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on api_usage as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
