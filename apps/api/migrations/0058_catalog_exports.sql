-- SAPI 16 (#301): the store's product and stock exports as jobs (FIRST-RELEASE §13, CATALOG K8–K9). Asked for,
-- built after commit through the outbox in the asker's own scope, read back by id; kept on the row until it
-- expires (LOGGING §6), as the partner's exports are (0021). A supplier's are its own, holding its rows only.

create table catalog_export (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  -- The supplier asking, from the session; null for the merchant side (DATA-MODEL §7.1).
  seller_id uuid references seller (id),
  kind text not null check (kind in ('products', 'stock')),
  filter jsonb not null,
  state text not null default 'queued' check (state in ('queued', 'done', 'failed')),
  rows integer check (rows >= 0),
  truncated boolean not null default false,
  csv text,
  requested_by_id uuid not null,
  requested_by_label text not null,
  created_at timestamptz(3) not null default now(),
  finished_at timestamptz(3),
  expires_at timestamptz(3),
  constraint catalog_export_done check ((state = 'done') = (csv is not null and rows is not null and finished_at is not null and expires_at is not null))
);

create index catalog_export_requester_idx on catalog_export (store_id, requested_by_id, created_at desc, id desc);

grant select, insert on catalog_export to app_request, app_supplier;
grant update (state, rows, truncated, csv, finished_at, expires_at) on catalog_export to app_request, app_supplier;
grant select, insert, update, delete on catalog_export to app_system;

alter table catalog_export enable row level security;
alter table catalog_export force row level security;
create policy catalog_export_system on catalog_export for all to app_system using (true) with check (true);
-- The merchant side reaches the store's exports; a supplier its own only, so it can't ask in another's name.
create policy catalog_export_store on catalog_export for all to app_request, app_supplier
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')));
create policy request_scope on catalog_export as restrictive for all to app_request, app_supplier
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on catalog_export as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on catalog_export as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on catalog_export as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on catalog_export as restrictive for insert to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_update on catalog_export as restrictive for update to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_delete on catalog_export as restrictive for delete to app_request, app_supplier using (app_setting_text('app.support') <> 'read');
