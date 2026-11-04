-- A signed-in shopper's wishlist (#1213; DATA-MODEL §7.6): per product, one row for each customer account in a store.
-- Rows go with the account or the product (on delete cascade), so erasing either leaves nothing behind.
create table wishlist_item (
  store_id uuid not null references store (id),
  customer_id uuid not null references customer (id) on delete cascade,
  product_id uuid not null references product (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (store_id, customer_id, product_id)
);
create index wishlist_item_listing_idx on wishlist_item (store_id, customer_id, created_at desc);

-- The shopper keeps its own list; the merchant side reads it for an abandoned cart's page; nothing else touches it.
grant select, insert, delete on wishlist_item to app_system;
grant select, insert, delete on wishlist_item to app_shop;
grant select on wishlist_item to app_request;

alter table wishlist_item enable row level security;
alter table wishlist_item force row level security;
create policy wishlist_item_system on wishlist_item for all to app_system using (true) with check (true);
create policy request_scope on wishlist_item as restrictive for all to app_request, app_shop
  using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'))
  with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'));
create policy partner_scope on wishlist_item as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on wishlist_item as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on wishlist_item as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- A shopper's own items only, in its own store.
create policy wishlist_item_shop on wishlist_item for all to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and customer_id = app_setting_uuid('app.customer_id'))
with check (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and customer_id = app_setting_uuid('app.customer_id'));
-- The merchant side reads its store's, never a supplier (a supplier's scope names a seller).
create policy wishlist_item_merchant on wishlist_item for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
