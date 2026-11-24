-- #1691: a shopper reads their order's courier shipments (DATA-MODEL §7.6, §7.11), through that order's own shop policy as
-- 0367's delivery_shop_select does. Only a parcel on its way to them: never a supplier's hand-off to the store, a pickup or
-- an own delivery (that is `delivery`), nor the label, booking or warehouse columns. Backward-compatible.

grant select (id, store_id, order_id, kind, courier_name, tracking_number, tracking_url, shipped_at) on fulfilment to app_shop;
create policy fulfilment_shop_select on fulfilment for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and kind in ('booked', 'manual')
  and exists (select 1 from "order" o where o.id = fulfilment.order_id and o.store_id = fulfilment.store_id));
