-- #1465: a cart line whose product was hidden or deleted still shows its photo, so the file stays fetchable by its id.
-- Backward-compatible: it only adds a way to read; the previous release's reads are unchanged (DATA-MODEL §7.11).
grant select (asset_id) on product_photo to app_definer;

create function asset_is_product_photo(file uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from product_photo x where x.asset_id = file) $$;
alter function asset_is_product_photo(uuid) owner to app_definer;
grant execute on function asset_is_product_photo(uuid) to app_shop;

alter policy asset_shop on asset using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and (
  storefront_visible
  or exists (select 1 from product_photo x where x.asset_id = asset.id)
  or asset_is_product_photo(asset.id)
  or exists (select 1 from product_video x where x.asset_id = asset.id)
  or exists (select 1 from product_question_choice x where x.photo_asset_id = asset.id)
  or exists (select 1 from collection x where x.image_asset_id = asset.id)
  or exists (select 1 from product_story x where asset.id = any (x.asset_ids))
  or exists (select 1 from story_block x where asset.id = any (x.asset_ids))
  or exists (select 1 from store x where x.logo_asset_id = asset.id)
  or exists (select 1 from storefront_content x where asset.id = any (x.asset_ids))
  or exists (select 1 from storefront_content_translation x where asset.id = any (x.asset_ids))
  or exists (select 1 from storefront_brand x where asset.id in (x.logo_asset_id, x.favicon_asset_id))
  or exists (select 1 from storefront_seo x where x.share_asset_id = asset.id)));
