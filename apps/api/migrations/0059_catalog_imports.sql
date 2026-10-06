-- SAPI 16 (#301): a store's catalogue imports as jobs (FIRST-RELEASE §13, CATALOG K). Checked after upload,
-- nothing written until confirmed, then run a chunk at a time through the outbox in the importer's own scope,
-- so a supplier's import writes only its own rows. The file is kept until the run ends; the error file for a day.

create table catalog_import (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  -- The supplier importing, from the session; null for the merchant side (DATA-MODEL §7.1).
  seller_id uuid references seller (id),
  source text not null check (source in ('csv', 'shopify')),
  state text not null default 'checking' check (state in ('checking', 'ready', 'running', 'done', 'failed')),
  file text,
  plan jsonb,
  match_mode text check (match_mode in ('update', 'skip')),
  warehouse_id uuid references warehouse (id),
  products integer not null default 0 check (products >= 0),
  ready integer not null default 0 check (ready >= 0),
  matched integer not null default 0 check (matched >= 0),
  problems jsonb not null default '[]',
  done integer not null default 0 check (done >= 0),
  created integer not null default 0 check (created >= 0),
  updated integer not null default 0 check (updated >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  failed integer not null default 0 check (failed >= 0),
  photos_pending integer not null default 0 check (photos_pending >= 0),
  problems_csv text,
  requested_by_id uuid not null,
  requested_by_label text not null,
  created_at timestamptz(3) not null default now(),
  started_at timestamptz(3),
  finished_at timestamptz(3),
  expires_at timestamptz(3)
);

create index catalog_import_requester_idx on catalog_import (store_id, requested_by_id, created_at desc, id desc);

grant select, insert on catalog_import to app_request, app_supplier;
grant update (state, source, file, plan, match_mode, warehouse_id, products, ready, matched, problems, done, created, updated, skipped, failed,
  photos_pending, problems_csv, started_at, finished_at, expires_at) on catalog_import to app_request, app_supplier;
grant select, insert, update, delete on catalog_import to app_system;

alter table catalog_import enable row level security;
alter table catalog_import force row level security;
create policy catalog_import_system on catalog_import for all to app_system using (true) with check (true);
-- The merchant side reaches the store's imports; a supplier its own only.
create policy catalog_import_store on catalog_import for all to app_request, app_supplier
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')));
create policy request_scope on catalog_import as restrictive for all to app_request, app_supplier
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on catalog_import as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on catalog_import as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on catalog_import as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on catalog_import as restrictive for insert to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_update on catalog_import as restrictive for update to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_delete on catalog_import as restrictive for delete to app_request, app_supplier using (app_setting_text('app.support') <> 'read');

-- An imported count is a movement of its own (stock_movement's 'import', DATA-MODEL §7.10's import_job).
create or replace function stock_change(p_version uuid, p_location uuid, p_delta integer, p_target integer, p_reason text, out quantity integer, out change integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := app_setting_uuid('app.store_id');
  v_seller text := app_setting_text('app.seller_id');
  v_warehouse record;
  v_version record;
  v_before integer;
  v_change integer;
  v_after integer;
  v_reason text := p_reason;
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.support') = 'read' then
    raise exception 'stock: not in this scope' using errcode = '42501';
  end if;
  -- A person's reasons, and their import's (#301); orders and returns write theirs through their own system paths.
  if p_reason not in ('received', 'returned', 'damaged', 'counted', 'typed', 'import') or (p_delta is null) = (p_target is null) then
    raise exception 'stock: a change needs one amount and a known reason' using errcode = '22023';
  end if;
  -- Shared, so a delete of the location waits for this count, or this count finds it gone.
  select store_id, seller_id into v_warehouse from warehouse where id = p_location and store_id = v_store and deleted_at is null for share;
  select store_id, seller_id into v_version from product_version where id = p_version and store_id = v_store and deleted_at is null;
  -- The merchant side counts its own locations (ACCESS §5.1); a supplier its own, of its own versions.
  if v_warehouse.store_id is null or v_version.store_id is null
     or (v_seller = '' and v_warehouse.seller_id is not null)
     or (v_seller <> '' and (v_warehouse.seller_id is distinct from v_seller::uuid or v_version.seller_id is distinct from v_seller::uuid)) then
    raise exception 'stock: no such version or location' using errcode = '23503';
  end if;
  insert into stock_level (version_id, warehouse_id, store_id) values (p_version, p_location, v_store) on conflict do nothing;
  select on_hand into v_before from stock_level where version_id = p_version and warehouse_id = p_location for update;
  v_change := coalesce(p_delta, p_target - v_before);
  v_after := v_before + v_change;
  if v_after < 0 then
    raise exception 'stock: that would take stock below zero' using errcode = '23514';
  end if;
  quantity := v_after;
  change := v_change;
  if v_change = 0 then
    return;
  end if;
  -- A location's first count of a version is its starting stock (CatEditor).
  if v_reason = 'typed' and not exists (select 1 from stock_movement m where m.version_id = p_version and m.warehouse_id = p_location) then
    v_reason := 'starting';
  end if;
  update stock_level set on_hand = v_after, updated_at = now() where version_id = p_version and warehouse_id = p_location;
  -- The clock, not the transaction's start, so the changes of one save keep their order in the history.
  insert into stock_movement (store_id, version_id, warehouse_id, delta, resulting_quantity, reason, source_kind, actor_kind, actor_id, occurred_at)
  values (v_store, p_version, p_location, v_change, v_after, v_reason, null,
    case when app_setting_text('app.impersonation_id') <> '' then 'impersonation' when app_setting_text('app.user_id') <> '' then 'person' else 'system' end,
    case when app_setting_text('app.impersonation_id') <> '' then app_setting_uuid('app.impersonation_id') when app_setting_text('app.user_id') <> '' then app_setting_uuid('app.user_id') end,
    clock_timestamp());
end
$$;
