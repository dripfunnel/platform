-- The merchant's own request scope deletes a library file and marks one for the storefront, instead of system scope (#1022 review).
-- The row-level policies and read-only support blocks on asset are 0042's; design_message gets the same pair for the chat's picture.
grant delete, update (storefront_visible) on asset to app_request;
grant update (image_asset_id) on design_message to app_request;
create policy design_message_merchant_update on design_message for update to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy support_no_update on design_message as restrictive for update to app_request with check (app_setting_text('app.support') <> 'read');
