-- DL 6 (#843): carrying a delivery: pickup as a local shipment, the handover code and the last steps sent late
-- (DELIVERY §3, §4; DATA-MODEL §7.6, §7.12).

alter table fulfilment drop constraint fulfilment_kind_check;
alter table fulfilment add constraint fulfilment_kind_check check (kind in ('booked', 'manual', 'sent_to_store', 'pickup', 'local'));
-- A rider's pickup takes the stock out (DELIVERY §3 step 4).
alter table stock_movement drop constraint stock_movement_actor_kind_check;
alter table stock_movement add constraint stock_movement_actor_kind_check check (actor_kind in ('person', 'impersonation', 'system', 'rider'));

-- The area and the fee are copied at creation, so a rider's past deliveries show them without reading the order.
alter table delivery
  add column area text check (char_length(area) <= 200),
  add column fee_amount bigint check (fee_amount >= 0),
  add column failed_note text check (char_length(failed_note) between 1 and 500),
  add column step_key text check (char_length(step_key) between 1 and 100),
  add column step_result text check (step_result in ('delivered', 'failed', 'WRONG_CODE', 'CODE_LOCKED', 'CODE_UNCONFIRMED')),
  add constraint delivery_failed_reason check (failed_reason in ('no_one_home', 'refused', 'wrong_address', 'other', 'recalled', 'unconfirmed')),
  add constraint delivery_failed_note check (failed_note is null or failed_reason = 'other');
update delivery d set area = nullif(concat_ws(', ', nullif(o.shipping_address->>'postalCode', ''), o.shipping_address->>'city'), ''), fee_amount = o.shipping_amount
from "order" o where o.id = d.order_id;
grant select (area, fee_amount, failed_note, step_key, step_result) on delivery to app_request, app_rider;
grant insert (area, fee_amount) on delivery to app_request;

-- The rider reads, as itself, its deliveries' warehouses, the lines while it holds the parcel's job, and the customer
-- only while the parcel is in its hands (DELIVERY §4).
grant select (id, store_id, name, address, latitude, longitude) on warehouse to app_rider;
create policy warehouse_rider_select on warehouse for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and exists (
  select 1 from delivery d where d.warehouse_id = warehouse.id and d.store_id = warehouse.store_id and d.rider_id = app_setting_uuid('app.rider_id')));
grant select (id, order_id, store_id, name, version_name, quantity, position) on order_line to app_rider;
create policy order_line_rider_select on order_line for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and exists (
  select 1 from delivery d where d.order_id = order_line.order_id and d.store_id = order_line.store_id
    and d.rider_id = app_setting_uuid('app.rider_id') and d.state in ('assigned', 'picked_up')));
grant select (id, store_id, phone, shipping_address, shopper_note) on "order" to app_rider;
create policy order_rider_select on "order" for select to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and exists (
  select 1 from delivery d where d.order_id = "order".id and d.store_id = "order".store_id
    and d.rider_id = app_setting_uuid('app.rider_id') and d.state = 'picked_up'));

create index delivery_rider_done_idx on delivery (rider_id, delivered_at) where state = 'delivered';
