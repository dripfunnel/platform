-- DL 3 (#840): the phones a store's apps push to (DATA-MODEL §3.6, DELIVERY §6). Written in system scope; a rider reaches
-- only its own, and the merchant deletes its riders' with suspension and removal (decided on #840).

create table push_device (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  subject_kind text not null check (subject_kind in ('rider', 'customer', 'order')),
  subject_id uuid not null,
  expo_token text not null check (expo_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_device_store_token_key unique (store_id, expo_token)
);
create index push_device_subject_idx on push_device (store_id, subject_kind, subject_id);

grant select, insert, update, delete on push_device to app_system;
grant select (store_id, subject_kind, subject_id), delete on push_device to app_request;
grant select (id, store_id, subject_kind, subject_id, expo_token, platform), delete on push_device to app_rider;

alter table push_device enable row level security;
alter table push_device force row level security;
create policy push_device_system on push_device for all to app_system using (true) with check (true);
create policy request_scope on push_device as restrictive for all to app_request
  using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on push_device as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on push_device as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on push_device as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

create policy push_device_merchant_select on push_device for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '' and subject_kind = 'rider');
create policy push_device_merchant_delete on push_device for delete to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = ''
  and app_setting_text('app.support') <> 'read' and subject_kind = 'rider');

create policy push_device_own_select on push_device for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and subject_kind = 'rider' and subject_id = app_setting_uuid('app.rider_id'));
create policy push_device_own_delete on push_device for delete to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and subject_kind = 'rider' and subject_id = app_setting_uuid('app.rider_id'));
