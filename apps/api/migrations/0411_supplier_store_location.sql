-- #1353: a supplier with no location of its own counts its own versions in the store's default location (DATA-MODEL §7.4).
-- Backward-compatible: it only allows what was refused, and every existing row keeps its owner.

-- Stock sits with its version's owner: a supplier's version held in the store's location is that supplier's stock.
create or replace function stock_owner_from_warehouse() returns trigger
language plpgsql
as $$
declare
  w record;
  v record;
begin
  select store_id, seller_id into w from warehouse where id = new.warehouse_id and deleted_at is null;
  select store_id, seller_id, product_id into v from product_version where id = new.version_id and deleted_at is null;
  if w.store_id is distinct from new.store_id or v.store_id is distinct from new.store_id then
    raise exception 'stock: no such version or location in this store' using errcode = '23503';
  end if;
  if v.seller_id is not null and w.seller_id is not null and v.seller_id is distinct from w.seller_id then
    raise exception 'stock: that location can''t hold this version' using errcode = '23514';
  end if;
  new.seller_id := coalesce(w.seller_id, v.seller_id);
  if tg_table_name = 'stock_movement' then
    new.product_id := v.product_id;
    new.occurred_at := date_trunc('milliseconds', new.occurred_at);
  end if;
  return new;
end
$$;

-- The merchant's default location, and any of its locations already holding this supplier's stock, are readable to that
-- supplier; the API names them and never sends their address.
create policy warehouse_store_home on warehouse for select to app_supplier
using (
  app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') <> ''
  and seller_id is null and deleted_at is null
  and (is_default or exists (select 1 from stock_level l where l.warehouse_id = warehouse.id and l.seller_id = app_setting_uuid('app.seller_id')))
);

grant select (is_default) on warehouse to app_definer;

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
  if p_reason not in ('received', 'returned', 'damaged', 'counted', 'typed', 'import') or (p_delta is null) = (p_target is null) then
    raise exception 'stock: a change needs one amount and a known reason' using errcode = '22023';
  end if;
  select store_id, seller_id, is_default into v_warehouse from warehouse where id = p_location and store_id = v_store and deleted_at is null for share;
  select store_id, seller_id into v_version from product_version where id = p_version and store_id = v_store and deleted_at is null;
  -- The merchant side counts its own versions in its own locations (ACCESS §5.1). A supplier counts its own versions in its
  -- own locations, or in the store's: the default one while it has none of its own, and wherever it already holds stock.
  if v_warehouse.store_id is null or v_version.store_id is null
     or (v_seller = '' and (v_warehouse.seller_id is not null or v_version.seller_id is not null))
     or (v_seller <> '' and (
       v_version.seller_id is distinct from v_seller::uuid
       or not (
         v_warehouse.seller_id is not distinct from v_seller::uuid
         or (v_warehouse.seller_id is null and (
           exists (select 1 from stock_level l where l.version_id = p_version and l.warehouse_id = p_location)
           or (v_warehouse.is_default and not exists (select 1 from warehouse o where o.store_id = v_store and o.seller_id = v_seller::uuid and o.deleted_at is null))
         ))
       )
     )) then
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
  if v_reason = 'typed' and not exists (select 1 from stock_movement m where m.version_id = p_version and m.warehouse_id = p_location) then
    v_reason := 'starting';
  end if;
  update stock_level set on_hand = v_after, updated_at = now() where version_id = p_version and warehouse_id = p_location;
  insert into stock_movement (store_id, version_id, warehouse_id, delta, resulting_quantity, reason, source_kind, actor_kind, actor_id, occurred_at)
  values (v_store, p_version, p_location, v_change, v_after, v_reason, null,
    case when app_setting_text('app.impersonation_id') <> '' then 'impersonation' when app_setting_text('app.user_id') <> '' then 'person' else 'system' end,
    case when app_setting_text('app.impersonation_id') <> '' then app_setting_uuid('app.impersonation_id') when app_setting_text('app.user_id') <> '' then app_setting_uuid('app.user_id') end,
    clock_timestamp());
end
$$;
