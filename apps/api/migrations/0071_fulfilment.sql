-- SAPI 11 (#310), part 2: shipping an order's lines from a named location, by the store or by a supplier for its own part
-- (DATA-MODEL §7.6; ACCESS §7.3). Written by the engine in system scope, as stock leaving a location is (stock_level.reserved).

create table fulfilment (
  id uuid primary key default gen_random_uuid(),
  order_part_id uuid not null references order_part (id),
  order_id uuid not null,
  store_id uuid not null,
  -- The actor's owner, not the part's: a to-store supplier's hand-off carries its own, the store's onward shipment null,
  -- so a supplier never reads the shopper's tracking (ACCESS §7.3).
  seller_id uuid,
  kind text not null check (kind in ('booked', 'manual', 'sent_to_store', 'pickup')),
  warehouse_id uuid not null,
  courier_name text check (char_length(courier_name) between 1 and 80),
  tracking_number text check (char_length(tracking_number) between 1 and 80),
  tracking_url text check (char_length(tracking_url) <= 500 and tracking_url ~ '^https://'),
  shipped_at timestamptz not null,
  delivered_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references "order" (id, store_id),
  foreign key (warehouse_id, store_id) references warehouse (id, store_id),
  foreign key (seller_id, store_id) references seller (id, store_id)
);
create index fulfilment_order_idx on fulfilment (order_id, shipped_at);
create index fulfilment_seller_idx on fulfilment (store_id, seller_id) where seller_id is not null;

create table fulfilment_line (
  fulfilment_id uuid not null references fulfilment (id),
  order_line_id uuid not null references order_line (id),
  store_id uuid not null,
  seller_id uuid,
  quantity integer not null check (quantity between 1 and 999),
  primary key (fulfilment_id, order_line_id)
);
create index fulfilment_line_order_line_idx on fulfilment_line (order_line_id);

grant select, insert, update on fulfilment, fulfilment_line to app_system;
grant select on fulfilment, fulfilment_line to app_request, app_supplier;

do $$
declare
  t text;
begin
  foreach t in array array['fulfilment', 'fulfilment_line'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy %I on %I for select to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
    execute format('create policy %I on %I for select to app_supplier
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and seller_id = app_setting_uuid(''app.seller_id''))', t || '_supplier', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request, app_supplier
      using (app_setting_text(''app.scope'') = ''store'') with check (app_setting_text(''app.scope'') = ''store'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
  end loop;
end
$$;

