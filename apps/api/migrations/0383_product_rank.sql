-- Best sellers (#1242; DATA-MODEL §7.3): each store's products by units sold in the last 90 days, refreshed hourly by
-- cron in system scope. A shopper reads only the position, which the BEST_SELLING sort orders by; never the units.
create table product_rank (
  store_id uuid not null references store (id),
  product_id uuid not null,
  units bigint not null check (units > 0),
  -- 1 is the store's best seller; ties go by product id, so the order is stable between runs.
  position integer not null check (position > 0),
  ranked_at timestamptz(3) not null,
  primary key (store_id, product_id),
  foreign key (product_id, store_id) references product (id, store_id) on delete cascade
);
create index product_rank_position_idx on product_rank (store_id, position);

grant select, insert, update, delete on product_rank to app_system;
grant select on product_rank to app_request;
grant select (store_id, product_id, position) on product_rank to app_shop;

alter table product_rank enable row level security;
alter table product_rank force row level security;
create policy product_rank_system on product_rank for all to app_system using (true) with check (true);
create policy request_scope on product_rank as restrictive for all to app_request, app_shop
  using (app_setting_text('app.scope') in ('store', 'shop') and (current_user <> 'app_shop' or app_setting_text('app.scope') = 'shop'))
  with check (false);
create policy partner_scope on product_rank as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on product_rank as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on product_rank as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- The merchant side reads its own store's (the studio's summary), never a supplier; a shopper its storefront's store.
create policy product_rank_merchant on product_rank for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy product_rank_shop on product_rank for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id'));
