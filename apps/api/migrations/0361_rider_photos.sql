-- #839's review: a rider's own photos are counted for its upload limit, and deleted with its account (DELIVERY §4, §5).
grant select (created_at, r2_key) on asset to app_rider;
grant delete on asset to app_rider;
create policy asset_rider_delete on asset for delete to app_rider
using (app_setting_text('app.scope') = 'delivery' and store_id = app_setting_uuid('app.store_id') and created_by = app_setting_uuid('app.rider_id'));
