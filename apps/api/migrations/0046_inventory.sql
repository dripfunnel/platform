-- SAPI 4 (#294): stock locations, stock per version and location, and the movement ledger (DATA-MODEL §7.4).
-- Store-and-seller like the catalogue; quantities change only through `stock_change()`, which writes the
-- movement with the real actor, so a caller can neither skip the ledger nor forge it.

create table warehouse (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  seller_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  address jsonb not null default '{}' check (jsonb_typeof(address) = 'object'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  deleted_at timestamptz,
  unique (id, store_id),
  foreign key (seller_id, store_id) references seller (id, store_id)
);

-- One default per owner, the merchant's null owner counting once too.
create unique index warehouse_default_key on warehouse (store_id, coalesce(seller_id, '00000000-0000-0000-0000-000000000000'))
  where is_default and deleted_at is null;
create index warehouse_store_idx on warehouse (store_id, created_at, id) where deleted_at is null;

create table stock_level (
  version_id uuid not null,
  warehouse_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  on_hand integer not null default 0 check (on_hand >= 0),
  -- Sold, not shipped yet (PLATFORM-PROMPT §5.4): written only by orders, in system scope.
  reserved integer not null default 0 check (reserved >= 0),
  low_stock_threshold integer check (low_stock_threshold between 0 and 1000000),
  updated_at timestamptz not null default now(),
  primary key (version_id, warehouse_id),
  foreign key (version_id, store_id) references product_version (id, store_id),
  foreign key (warehouse_id, store_id) references warehouse (id, store_id)
);

create index stock_level_warehouse_idx on stock_level (warehouse_id) where on_hand > 0;

create table stock_movement (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_id uuid,
  product_id uuid not null,
  version_id uuid not null,
  warehouse_id uuid not null,
  delta integer not null,
  resulting_quantity integer not null check (resulting_quantity >= 0),
  reason text not null check (reason in ('received', 'returned', 'damaged', 'counted', 'typed', 'order', 'import', 'starting', 'transfer')),
  source_kind text check (source_kind in ('order', 'return', 'import')),
  source_id uuid,
  actor_kind text not null check (actor_kind in ('person', 'impersonation', 'system')),
  actor_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (version_id, store_id) references product_version (id, store_id),
  foreign key (warehouse_id, store_id) references warehouse (id, store_id)
);

create index stock_movement_product_idx on stock_movement (product_id, occurred_at desc, id desc);
create index stock_movement_version_idx on stock_movement (version_id, occurred_at desc, id desc);

-- Stock sits with the location's owner; a version is held by its own owner's location or, for the
-- merchant's versions, any location (DATA-MODEL §7.4).
create function stock_owner_from_warehouse() returns trigger
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
  if v.seller_id is not null and v.seller_id is distinct from w.seller_id then
    raise exception 'stock: that location can''t hold this version' using errcode = '23514';
  end if;
  new.seller_id := w.seller_id;
  if tg_table_name = 'stock_movement' then
    new.product_id := v.product_id;
  end if;
  return new;
end
$$;

create trigger stock_level_owner before insert or update of version_id, warehouse_id, store_id on stock_level for each row execute function stock_owner_from_warehouse();
create trigger stock_movement_owner before insert on stock_movement for each row execute function stock_owner_from_warehouse();

-- A supplier's location is its own: it can't make one in the merchant's name or another supplier's.
create function warehouse_owner_check() returns trigger
language plpgsql
as $$
begin
  if app_setting_text('app.seller_id') <> '' and new.seller_id is distinct from app_setting_uuid('app.seller_id') then
    raise exception 'stock: a supplier adds its own locations' using errcode = '42501';
  end if;
  -- The merchant side reads a supplier's locations but never edits them: they are the supplier's count (SetOps).
  if app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') = '' and new.seller_id is not null then
    raise exception 'stock: a supplier''s location is theirs to change' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger warehouse_owner_check before insert or update on warehouse for each row execute function warehouse_owner_check();

-- The one write path for a quantity from the Store API (G4): `delta`, or `target` for a typed number. The
-- caller's own scope decides what it reaches: the merchant side its own locations, a supplier its own.
create function stock_change(p_version uuid, p_location uuid, p_delta integer, p_target integer, p_reason text, out quantity integer, out change integer)
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
  select store_id, seller_id into v_warehouse from warehouse where id = p_location and store_id = v_store and deleted_at is null;
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
  values (v_store, p_version, p_location, v_change, v_after, v_reason, case when v_reason = 'import' then 'import' end,
    case when app_setting_text('app.impersonation_id') <> '' then 'impersonation' when app_setting_text('app.user_id') <> '' then 'person' else 'system' end,
    case when app_setting_text('app.impersonation_id') <> '' then app_setting_uuid('app.impersonation_id') when app_setting_text('app.user_id') <> '' then app_setting_uuid('app.user_id') end,
    clock_timestamp());
end
$$;

grant select (id, store_id, seller_id, deleted_at) on warehouse to app_definer;
grant select (id, store_id, seller_id, product_id, deleted_at) on product_version to app_definer;
grant select, insert, update (on_hand, updated_at) on stock_level to app_definer;
grant select (version_id, warehouse_id), insert on stock_movement to app_definer;
alter function stock_change(uuid, uuid, integer, integer, text, out integer, out integer) owner to app_definer;
revoke execute on function stock_change(uuid, uuid, integer, integer, text, out integer, out integer) from public;
grant execute on function stock_change(uuid, uuid, integer, integer, text, out integer, out integer) to app_request;

-- Every store has the merchant's default location from the start, whichever path made the store (SetOps).
create function store_default_warehouse() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into warehouse (store_id, name, is_default) values (new.id, 'Main location', true);
  return new;
end
$$;

grant insert on warehouse to app_definer;
alter function store_default_warehouse() owner to app_definer;
create trigger store_default_warehouse after insert on store for each row execute function store_default_warehouse();

insert into warehouse (store_id, name, is_default) select s.id, 'Main location', true from store s;

grant select, insert on warehouse to app_request;
grant update (name, address, is_default, updated_at, revision, deleted_at) on warehouse to app_request;
grant select on stock_level, stock_movement to app_request;
grant update (low_stock_threshold) on stock_level to app_request;
grant select, insert, update, delete on warehouse, stock_level, stock_movement to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['warehouse', 'stock_level', 'stock_movement'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))
      with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy support_no_insert on %I as restrictive for insert to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_update on %I as restrictive for update to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_delete on %I as restrictive for delete to app_request using (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))', t || '_store', t);
  end loop;
end
$$;
