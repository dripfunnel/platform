-- DL 1 (#838): a store's own delivery people with their sessions and codes (DATA-MODEL §3.6), and the plan settings own
-- delivery and the store's apps need (SAAS §6.1). No seller or partner branch: neither ever reads a rider.

-- Enterprise only (DELIVERY §9): off and zero in every plan version written so far.
insert into plan_key (key, kind) values ('own_delivery', 'switch'), ('riders', 'amount'), ('own_apps', 'switch');
insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount)
select v.plan_id, v.partner_id, v.version, k.key, case when k.kind = 'switch' then false end, case when k.kind = 'amount' then 0 end
from plan_version v
cross join plan_key k
where k.key in ('own_delivery', 'riders', 'own_apps')
on conflict do nothing;

-- Removal erases the phone and the photo and keeps the name past deliveries show (AGENTS.md "Data").
create table rider (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null check (char_length(name) between 1 and 120),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  photo_asset_id uuid references asset (id),
  vehicle_type text check (vehicle_type in ('bike', 'scooter', 'car', 'bicycle', 'foot')),
  vehicle_number text check (char_length(vehicle_number) between 1 and 20),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended', 'removed')),
  online_at timestamptz,
  invited_by_user_id uuid references "user" (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint rider_phone_kept check ((status = 'removed') = (phone is null)),
  constraint rider_removed_at check ((status = 'removed') = (removed_at is not null))
);
create unique index rider_store_phone_key on rider (store_id, phone) where status <> 'removed';
create index rider_store_status_idx on rider (store_id, status);
create index rider_store_list_idx on rider (store_id, created_at desc, id desc) where status <> 'removed';

-- As customer_session: the token hashed, 30 days from the last use; suspension and removal end every one.
create table rider_session (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  store_id uuid not null references store (id),
  rider_id uuid not null references rider (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create index rider_session_rider_idx on rider_session (rider_id) where ended_at is null;

-- As customer_code: 6 digits, hashed, 5 tries, 10 minutes; only for an invited or active rider's number (DELIVERY §4).
create table rider_code (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  phone text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  code_hash text check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 100),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index rider_code_phone_idx on rider_code (store_id, phone, created_at desc);

-- The Delivery API signs riders in in system scope (DL 2), as the Shop API does shoppers.
grant select, insert, update, delete on rider, rider_session, rider_code to app_system;
-- The merchant side (Settings › Riders, the Owner's) invites, suspends, restores and removes; never a hash or a code.
grant select on rider to app_request;
grant insert (store_id, name, phone, status, invited_by_user_id) on rider to app_request;
grant update (status, phone, photo_asset_id, online_at, updated_at, removed_at) on rider to app_request;
grant select (store_id, rider_id, ended_at), update (ended_at) on rider_session to app_request;

do $$
declare
  t text;
begin
  foreach t in array array['rider', 'rider_session', 'rider_code'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') = ''store'') with check (app_setting_text(''app.scope'') = ''store'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
end
$$;

create policy rider_merchant_select on rider for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy rider_merchant_insert on rider for insert to app_request
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
create policy rider_merchant_update on rider for update to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
create policy rider_session_merchant_select on rider_session for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy rider_session_merchant_update on rider_session for update to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and app_setting_text('app.support') <> 'read');
