-- SAPI 20 (#330), part 2, review: a store reads the apps it holds a live grant for, suspended or not, so its Apps
-- list says one is paused and it can still be uninstalled; any other app it reads only while live (0152).

drop policy app_store_read on app;
create policy app_store_read on app for select to app_request
using (app_setting_text('app.scope') = 'store' and (
  status = 'live'
  or exists (select 1 from app_grant g where g.app_id = app.id and g.store_id = app_setting_uuid('app.store_id') and g.revoked_at is null)
));
