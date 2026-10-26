-- DL 4 (#841): own delivery as a Shipping method (DELIVERY §2; DATA-MODEL §7.12). Every new column defaults to off, so
-- each store's options stay as they were; the previous release's inserts and updates still work.

alter table store_shipping
  add column own_delivery_enabled boolean not null default false,
  add column dispatch_when text not null default 'ready' check (dispatch_when in ('placed', 'ready')),
  add column offer_minutes integer not null default 5 check (offer_minutes between 1 and 30);

-- Areas in metres, 1–50 km; the fee in delivery_fee_currency, the pricing currency when saved. Never a supplier's location.
alter table warehouse
  add column own_delivery boolean not null default false,
  add column delivery_radius_m integer check (delivery_radius_m between 1000 and 50000),
  add column rider_radius_m integer not null default 5000 check (rider_radius_m between 1000 and 50000),
  add column delivery_fee_amount bigint check (delivery_fee_amount between 0 and 1000000000000),
  add column delivery_fee_currency text check (delivery_fee_currency ~ '^[A-Z]{3}$'),
  add constraint warehouse_delivery_fee_whole check ((delivery_fee_amount is null) = (delivery_fee_currency is null)),
  add constraint warehouse_own_delivery_ready check (not own_delivery or (seller_id is null and latitude is not null and delivery_radius_m is not null and delivery_fee_amount is not null));

-- app_supplier holds no update on these, so only the merchant side makes a location deliver.
grant update (own_delivery, delivery_radius_m, rider_radius_m, delivery_fee_amount, delivery_fee_currency) on warehouse to app_request;

-- A cart's and an order's delivering warehouse: the engine's to write in system scope, never the shopper's to read or write.
alter table "order"
  add column delivery_warehouse_id uuid,
  add foreign key (delivery_warehouse_id, store_id) references warehouse (id, store_id),
  drop constraint order_shipping_option_check,
  add constraint order_shipping_option_check check (shipping_option in ('courier', 'flat', 'pickup', 'own_delivery')),
  add constraint order_delivery_warehouse check (state = 'cart' or (coalesce(shipping_option, '') = 'own_delivery') = (delivery_warehouse_id is not null));
grant select (delivery_warehouse_id) on "order" to app_request;

grant select (own_delivery_enabled) on store_shipping to app_shop;

-- The pricing currency moving drops a warehouse's fee and its own delivery with it, as a market's charge (0063).
create or replace function store_markets_follow_currency() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update market set currency = new.pricing_currency, delivery_amount = null, revision = revision + 1, updated_at = now()
  where store_id = new.id and deleted_at is null and (currency = old.pricing_currency or (old.pricing_currency is null and is_primary));
  update warehouse set own_delivery = false, delivery_fee_amount = null, delivery_fee_currency = null, revision = revision + 1, updated_at = now()
  where store_id = new.id and delivery_fee_currency is not null and delivery_fee_currency <> new.pricing_currency;
  return new;
end
$$;
grant select (store_id, delivery_fee_currency, revision) on warehouse to app_definer;
grant update (own_delivery, delivery_fee_amount, delivery_fee_currency, revision) on warehouse to app_definer;

-- DELIVERY §2: the nearest of the acting store's delivering warehouses whose area holds the pin and whose free stock covers
-- every tracked line the store owns; none for a to-shopper supplier's line. Haversine on the pins (DELIVERY §11).
create function shop_delivering_warehouse(latitude double precision, longitude double precision, lines jsonb)
returns table (warehouse_id uuid, fee_amount bigint, fee_currency text, distance_m double precision)
language sql
stable
security definer
set search_path = public
as $$
  with line as (
    select x.version_id, x.quantity, v.track_stock, p.seller_id, s.shipping_mode
    from jsonb_to_recordset(lines) as x(version_id uuid, quantity integer)
    join product_version v on v.id = x.version_id and v.store_id = app_setting_uuid('app.store_id')
    join product p on p.id = v.product_id
    left join seller s on s.id = p.seller_id
  ),
  near as (
    select w.id, w.delivery_fee_amount, w.delivery_fee_currency,
      2 * 6371000 * asin(sqrt(power(sin(radians(w.latitude - shop_delivering_warehouse.latitude) / 2), 2)
        + cos(radians(shop_delivering_warehouse.latitude)) * cos(radians(w.latitude)) * power(sin(radians(w.longitude - shop_delivering_warehouse.longitude) / 2), 2))) as distance
    from warehouse w
    where w.store_id = app_setting_uuid('app.store_id') and w.seller_id is null and w.deleted_at is null and w.own_delivery
  )
  select n.id, n.delivery_fee_amount, n.delivery_fee_currency, n.distance
  from near n join warehouse w on w.id = n.id
  where app_setting_text('app.scope') = 'shop'
    and jsonb_array_length(lines) > 0
    and (select count(*) from line) = jsonb_array_length(lines)
    and not exists (select 1 from line where shipping_mode = 'to-shopper')
    and n.distance <= w.delivery_radius_m
    and not exists (
      select 1 from line l
      where l.seller_id is null and l.track_stock
        and coalesce((select k.on_hand - k.reserved from stock_level k where k.version_id = l.version_id and k.warehouse_id = n.id), 0) < l.quantity
    )
  order by n.distance, n.id
  limit 1
$$;
grant select (seller_id) on product to app_definer;
grant select (shipping_mode) on seller to app_definer;
grant select (store_id, latitude, longitude, own_delivery, delivery_radius_m, delivery_fee_amount, delivery_fee_currency) on warehouse to app_definer;
alter function shop_delivering_warehouse(double precision, double precision, jsonb) owner to app_definer;
revoke execute on function shop_delivering_warehouse(double precision, double precision, jsonb) from public;
grant execute on function shop_delivering_warehouse(double precision, double precision, jsonb) to app_shop;
