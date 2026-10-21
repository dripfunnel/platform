-- SAPI 11 (#310), part 1: the merchant's orders and a supplier's own part of them (DATA-MODEL §7.6, §7.11; ACCESS §7.3).
-- The merchant side already reads every order table (0068); a supplier reads its parts and its lines without money, and
-- the order and its own lines' money only through two views that show it nothing more.

grant select on order_part to app_supplier;
grant select (id, order_id, store_id, seller_id, version_id, product_id, name, version_name, sku, hs_code, quantity, weight_grams,
  fulfilled_quantity, returned_quantity, refunded_quantity, position) on order_line to app_supplier;

do $$
declare
  t text;
begin
  foreach t in array array['order_line', 'order_part'] loop
    execute format('create policy %I on %I for select to app_supplier
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and seller_id = app_setting_uuid(''app.seller_id''))', t || '_supplier', t);
    execute format('alter policy request_scope on %I to app_request, app_shop, app_supplier', t);
  end loop;
end
$$;
create index order_part_seller_idx on order_part (store_id, seller_id, order_id) where seller_id is not null;

-- What a supplier may know of an order holding its part: the shopper's name and delivery address only where the part
-- ships to the shopper, as placed, never as the supplier's mode is now (ACCESS §7.3). Only an order that went through
-- (paid, or paid later by cash or transfer) on the live storefront: a card still being paid, or a preview's test, isn't work.
create view order_for_supplier with (security_barrier) as
  select o.id, o.store_id, p.seller_id, o.number, o.state, o.placed_at, o.currency, p.id as part_id, p.state as part_state, p.shipping_mode,
    case when p.shipping_mode = 'to-shopper' then o.shipping_address ->> 'name' end as customer_name,
    case when p.shipping_mode = 'to-shopper' then o.shipping_address end as shipping_address
  from "order" o join order_part p on p.order_id = o.id and p.store_id = o.store_id
  where app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') <> ''
    and o.store_id = app_setting_uuid('app.store_id') and p.seller_id = app_setting_uuid('app.seller_id') and o.state <> 'cart'
    and (o.payment_state <> 'pending' or o.payment_method in ('cod', 'bank_transfer'))
    and not exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test');

-- The one place a supplier sees money: its own lines at the price sold, before the order's discount and tax (§7.11).
create view order_line_for_supplier with (security_barrier) as
  select l.id, l.order_id, l.store_id, l.seller_id, l.quantity, l.unit_amount, l.unit_amount * l.quantity as line_amount, o.currency
  from order_line l join "order" o on o.id = l.order_id and o.store_id = l.store_id
  where app_setting_text('app.scope') = 'store' and app_setting_text('app.seller_id') <> ''
    and l.store_id = app_setting_uuid('app.store_id') and l.seller_id = app_setting_uuid('app.seller_id') and o.state <> 'cart'
    and (o.payment_state <> 'pending' or o.payment_method in ('cod', 'bank_transfer'))
    and not exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test');

grant select (id, store_id, number, state, payment_state, payment_method, placed_at, currency, shipping_address) on "order" to app_definer;
grant select (order_id, mode) on payment to app_definer;
grant select (id, order_id, store_id, seller_id, state, shipping_mode) on order_part to app_definer;
grant select (id, order_id, store_id, seller_id, quantity, unit_amount) on order_line to app_definer;
alter view order_for_supplier owner to app_definer;
alter view order_line_for_supplier owner to app_definer;
grant select on order_for_supplier, order_line_for_supplier to app_supplier;
