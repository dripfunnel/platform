-- DL 2 (#839): riders sign in to the Delivery API (api/DELIVERY.md §4, §5). Codes and sessions are written in system
-- scope, as shoppers' are; a signed-in rider runs as its own request role, app_rider, reaching only its own row, its
-- sessions, the photos it uploads and its own activity entries (DATA-MODEL §5.3, §7.12).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_rider') then
    create role app_rider nologin;
  end if;
end
$$;

-- Whoever may become app_request (the Worker's login) may become app_rider, as 0064 did for app_shop.
do $$
declare
  login text;
begin
  for login in select m.member::regrole::text from pg_auth_members m where m.roleid = 'app_request'::regrole loop
    execute format('grant app_rider to %s', login);
  end loop;
end
$$;

grant usage on schema public to app_rider;

-- The log names riders as actors and the Delivery API as where it happened (LOGGING §4).
alter table activity_log drop constraint activity_log_actor_kind_check;
alter table activity_log add constraint activity_log_actor_kind_check check (
  actor_kind in ('staff', 'partner_user', 'person', 'customer', 'rider', 'api_key', 'app_grant', 'support_session', 'job', 'provider', 'anonymous')
);
alter table activity_log drop constraint activity_log_api_check;
alter table activity_log add constraint activity_log_api_check check (api in ('admin', 'platform', 'store', 'shop', 'delivery', 'system'));

-- The rider's own row: read, its profile written, and its own account deleted (removal, as an Owner's; DELIVERY §5).
-- Only while active: a suspended rider is signed out, so it reaches nothing here.
grant select (id, store_id, name, phone, photo_asset_id, vehicle_type, vehicle_number, status, online_at, created_at) on rider to app_rider;
grant update (name, photo_asset_id, vehicle_type, vehicle_number, status, phone, online_at, updated_at, removed_at) on rider to app_rider;
create policy rider_own_select on rider for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and id = app_setting_uuid('app.rider_id'));
create policy rider_own_update on rider for update to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and id = app_setting_uuid('app.rider_id') and status = 'active')
with check (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and id = app_setting_uuid('app.rider_id') and status in ('active', 'removed'));

-- Its own sessions, only to end them when it deletes its account; the hashes stay app_system's.
grant select (store_id, rider_id, ended_at), update (ended_at) on rider_session to app_rider;
create policy rider_session_own_select on rider_session for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and rider_id = app_setting_uuid('app.rider_id'));
create policy rider_session_own_update on rider_session for update to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and rider_id = app_setting_uuid('app.rider_id'))
with check (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and rider_id = app_setting_uuid('app.rider_id'));

-- A profile photo it uploads: an image of its own store, the merchant side's (no seller), and its own to read back.
grant select (id, store_id, seller_id, kind, created_by) on asset to app_rider;
grant insert (store_id, seller_id, r2_key, kind, mime, bytes, width, height, checksum, created_by) on asset to app_rider;
create policy asset_rider_select on asset for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and created_by = app_setting_uuid('app.rider_id'));
create policy asset_rider_insert on asset for insert to app_rider
with check (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and seller_id is null
  and created_by = app_setting_uuid('app.rider_id') and kind = 'image');

-- Its own entries, as itself, in its own store (LOGGING §4); the id comes back to the writer.
grant insert on activity_log to app_rider;
grant select (id) on activity_log to app_rider;
create policy activity_log_rider_insert on activity_log for insert to app_rider
with check (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and partner_id = app_setting_uuid('app.partner_id')
  and seller_id is null and customer_id is null and actor_kind = 'rider' and actor_id = app_setting_text('app.rider_id') and api = 'delivery');
create policy activity_log_rider_select on activity_log for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and actor_kind = 'rider' and actor_id = app_setting_text('app.rider_id'));

-- The hourly purge finds codes by expiry, and a store's ten-minute cap counts its own (0359 indexes them by number).
create index rider_code_expires_idx on rider_code (expires_at);
create index rider_code_store_created_idx on rider_code (store_id, created_at desc);
