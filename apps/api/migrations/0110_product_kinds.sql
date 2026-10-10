-- SAPI 22 (#323), part 1: what a download, a service and a gift card hold in the catalogue (CATALOG-DESIGN T14;
-- FIRST-RELEASE §1; DATA-MODEL §7.3). Delivery after payment is part 2's.

alter table product
  add column download_mode text check (download_mode in ('file', 'keys')),
  add column download_asset_id uuid,
  add column download_limit integer not null default 5 check (download_limit in (3, 5, 10)),
  add column download_days integer not null default 30 check (download_days in (7, 30, 365)),
  add column service_duration text check (char_length(service_duration) between 1 and 60),
  add column service_location text check (char_length(service_location) between 1 and 200),
  -- Null never expires; the engine holds each region's shortest (decided on #337).
  add column gift_card_expiry_months integer check (gift_card_expiry_months between 12 and 120),
  add constraint product_download_asset_fkey foreign key (download_asset_id, store_id) references asset (id, store_id),
  -- Downloads, services and gift cards are the merchant's own (decided on #323): a supplier's product is a physical one.
  add constraint product_supplier_physical check (seller_id is null or product_type = 'physical') not valid;

grant update (download_mode, download_asset_id, download_limit, download_days, service_duration, service_location, gift_card_expiry_months)
  on product to app_request;
-- The product page says how long a service takes, where, how often a link works and when a card expires; never the file.
grant select (download_mode, download_limit, download_days, service_duration, service_location, gift_card_expiry_months) on product to app_shop;

-- A download's licence-key pool: each paid unit takes one (part 2). A key is never read back by the store's people once
-- saved, only counted; the shopper who bought it reads it on its order.
create table licence_key (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  product_id uuid not null,
  key text not null check (char_length(key) between 1 and 200),
  order_line_id uuid references order_line (id),
  assigned_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (product_id, store_id) references product (id, store_id),
  check ((order_line_id is null) = (assigned_at is null))
);
create unique index licence_key_product_key on licence_key (product_id, key);
create index licence_key_store_idx on licence_key (store_id, product_id);
create index licence_key_free_idx on licence_key (product_id, created_at) where order_line_id is null;

grant select (id, store_id, product_id, order_line_id, assigned_at, created_by, created_at) on licence_key to app_request;
grant insert (store_id, product_id, key, created_by) on licence_key to app_request;
grant select, insert, update on licence_key to app_system;

alter table licence_key enable row level security;
alter table licence_key force row level security;
-- The merchant side only: no supplier, partner, staff or shop branch (DATA-MODEL §7.11's store class).
create policy licence_key_merchant on licence_key for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy licence_key_merchant_insert on licence_key for insert to app_request
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = ''
  and app_setting_text('app.support') <> 'read'
  and exists (select 1 from product p where p.id = product_id and p.product_type = 'digital' and p.download_mode = 'keys' and p.deleted_at is null));
create policy licence_key_system on licence_key for all to app_system using (true) with check (true);
create policy request_scope on licence_key as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform')) with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on licence_key as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on licence_key as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on licence_key as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- A key-pool download counts its keys left, as a tracked version counts its stock: none left is sold out (CatEditor).
create or replace function shop_stock(version_ids uuid[]) returns table (version_id uuid, available integer, low boolean)
language sql
stable
security definer
set search_path = public
as $$
  select v.id,
    case
      when p.product_type = 'digital' and p.download_mode = 'keys' then (select count(*) from licence_key k where k.product_id = p.id and k.order_line_id is null)::int
      when v.track_stock then greatest(coalesce(sum(l.on_hand - l.reserved) filter (where w.id is not null), 0), 0)::int
    end,
    case
      when p.product_type = 'digital' and p.download_mode = 'keys' then (select count(*) from licence_key k where k.product_id = p.id and k.order_line_id is null) < 5
      else v.track_stock and coalesce(sum(l.on_hand - l.reserved) filter (where w.id is not null), 0) <= coalesce(min(l.low_stock_threshold) filter (where w.id is not null), 5)
    end
  from product_version v
  join product p on p.id = v.product_id
  left join stock_level l on l.version_id = v.id
  left join warehouse w on w.id = l.warehouse_id and w.deleted_at is null
  where app_setting_text('app.scope') = 'shop' and v.store_id = app_setting_uuid('app.store_id') and v.id = any (version_ids)
    and v.deleted_at is null and v.visibility = 'visible'
    and p.deleted_at is null and p.visibility = 'visible' and p.hidden_by is null and coalesce(p.approval_status, 'approved') = 'approved'
    and (p.publish_at is null or p.publish_at <= now()) and not p.is_sample
  group by v.id, v.track_stock, p.id, p.product_type, p.download_mode
$$;
grant select (product_type, download_mode) on product to app_definer;
grant select (product_id, order_line_id) on licence_key to app_definer;
