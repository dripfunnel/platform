-- SH 5 (#858): a customer follows an own-delivery order (DELIVERY §7; DATA-MODEL §7.12).
-- app_shop reads one order's delivery through that order's own shop policy (the account's, or a guest's token), so whoever
-- can read the order reads its delivery and nobody else does. The rider's details and position are read only while the
-- delivery is in the state that shows them. The sealed handover code is granted to no request role: the engine reads it
-- in system scope once the reader owns the order.

grant select (id, store_id, order_id, state, rider_id, created_at, ready_at, searching_at, unassigned_at, assigned_at, picked_up_at,
  delivered_at, failed_at, cancelled_at, eta_at, eta_computed_at) on delivery to app_shop;
create policy delivery_shop_select on delivery for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and exists (select 1 from "order" o where o.id = delivery.order_id and o.store_id = delivery.store_id));

grant select (id, store_id, name, phone, photo_asset_id, vehicle_type, vehicle_number) on rider to app_shop;
create policy rider_shop_select on rider for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and exists (select 1 from delivery d where d.rider_id = rider.id and d.store_id = rider.store_id and d.state in ('assigned', 'picked_up')));

grant select (rider_id, store_id, latitude, longitude, reported_at) on rider_position to app_shop;
create policy rider_position_shop_select on rider_position for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and exists (select 1 from delivery d where d.rider_id = rider_position.rider_id and d.store_id = rider_position.store_id and d.state = 'picked_up'));

-- The photo of a rider the reader can see, and only that file: the catalogue's rule for assets never reaches a rider's.
create policy asset_rider_photo_shop on asset for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and exists (select 1 from rider r where r.photo_asset_id = asset.id and r.store_id = asset.store_id));
