-- A merchant image a design uses is readable by shoppers (docs/storefront/AI-STUDIO.md §8). Set when the merchant attaches
-- the file to a design request; every other unreferenced file stays private, as 0290 left it. Additive, default false.
alter table asset add column if not exists storefront_visible boolean not null default false;
grant select (storefront_visible) on asset to app_shop;
alter policy asset_shop on asset using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and (
  storefront_visible
  or exists (select 1 from product_photo x where x.asset_id = asset.id)
  or exists (select 1 from product_video x where x.asset_id = asset.id)
  or exists (select 1 from collection x where x.image_asset_id = asset.id)
  or exists (select 1 from product_story x where asset.id = any (x.asset_ids))
  or exists (select 1 from story_block x where asset.id = any (x.asset_ids))
  or exists (select 1 from store x where x.logo_asset_id = asset.id)
  or exists (select 1 from storefront_content x where asset.id = any (x.asset_ids))
  or exists (select 1 from storefront_content_translation x where asset.id = any (x.asset_ids))
  or exists (select 1 from storefront_brand x where asset.id in (x.logo_asset_id, x.favicon_asset_id))
  or exists (select 1 from storefront_seo x where x.share_asset_id = asset.id)));
