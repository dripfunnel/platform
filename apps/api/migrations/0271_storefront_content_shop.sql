-- SAPI 24 (#338), part 2: a content page's or post's other languages, and the Shop API's read of what is live
-- (DATA-MODEL §7.8, §7.11). Nothing here is destructive: one new table, grants and policies.

create unique index storefront_content_id_store_key on storefront_content (id, store_id);

-- The other languages of a page or post. Its body is a document of blocks, so it keeps them here rather than in
-- `translation`'s text rows (DATA-MODEL §7.1); the main language stays on storefront_content.
create table storefront_content_translation (
  content_id uuid not null,
  store_id uuid not null,
  language text not null,
  title text not null check (char_length(title) between 1 and 200),
  body jsonb not null default '[]' check (jsonb_typeof(body) = 'array' and pg_column_size(body) <= 262144),
  seo_title text check (char_length(seo_title) between 1 and 60),
  seo_description text check (char_length(seo_description) between 1 and 160),
  asset_ids uuid[] not null default '{}',
  product_ids uuid[] not null default '{}',
  -- md5 of the main-language text it translated, so "changed since translated" is a comparison (as `translation`'s).
  source_hash text not null check (source_hash ~ '^[0-9a-f]{32}$'),
  updated_at timestamptz not null default now(),
  primary key (content_id, language),
  foreign key (content_id, store_id) references storefront_content (id, store_id),
  foreign key (store_id, language) references store_language (store_id, language)
);
create index storefront_content_translation_assets_idx on storefront_content_translation using gin (asset_ids);

grant select, insert, update, delete on storefront_content_translation to app_request;
grant select, insert, update, delete on storefront_content_translation to app_system;
alter table storefront_content_translation enable row level security;
alter table storefront_content_translation force row level security;
create policy storefront_content_translation_system on storefront_content_translation for all to app_system using (true) with check (true);
create policy storefront_content_translation_merchant on storefront_content_translation for all to app_request
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on storefront_content_translation as restrictive for all to app_request
  using (app_setting_text('app.scope') = 'store') with check (app_setting_text('app.scope') = 'store');
create policy partner_scope on storefront_content_translation as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on storefront_content_translation as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on storefront_content_translation as restrictive for all to app_system
  using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on storefront_content_translation as restrictive for insert to app_request with check (app_setting_text('app.support') <> 'read');
create policy support_no_update on storefront_content_translation as restrictive for update to app_request with check (app_setting_text('app.support') <> 'read');
create policy support_no_delete on storefront_content_translation as restrictive for delete to app_request using (app_setting_text('app.support') <> 'read');

-- What a shopper reads (DATA-MODEL §7.11): a live page or post by column, never a draft, a deleted one or one whose
-- date hasn't come. A scheduled post shows at its time; the job that marks it published moves the cache version.
grant select (id, store_id, kind, slug, title, body, seo_title, seo_description, status, publish_at, in_menu, author, tags,
  cover_asset_id, asset_ids, product_ids, updated_at, deleted_at) on storefront_content to app_shop;
grant select (content_id, store_id, language, title, body, seo_title, seo_description, asset_ids, product_ids) on storefront_content_translation to app_shop;
create policy storefront_content_shop on storefront_content for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and deleted_at is null
  and (status = 'published' or (status = 'scheduled' and publish_at <= now())));
create policy storefront_content_translation_shop on storefront_content_translation for select to app_shop
using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id')
  and exists (select 1 from storefront_content c where c.id = content_id));
do $$
declare
  t text;
begin
  foreach t in array array['storefront_content', 'storefront_content_translation'] loop
    execute format('alter policy request_scope on %I to app_request, app_shop
      using (app_setting_text(''app.scope'') in (''store'', ''shop'') and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))
      with check (app_setting_text(''app.scope'') = ''store'' and current_user <> ''app_shop'')', t);
  end loop;
end
$$;

-- A file a live page or post shows is one a shopper may fetch, as a product photo is (0064).
alter policy asset_shop on asset using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and (
  exists (select 1 from product_photo x where x.asset_id = asset.id)
  or exists (select 1 from product_video x where x.asset_id = asset.id)
  or exists (select 1 from collection x where x.image_asset_id = asset.id)
  or exists (select 1 from product_story x where asset.id = any (x.asset_ids))
  or exists (select 1 from story_block x where asset.id = any (x.asset_ids))
  or exists (select 1 from store x where x.logo_asset_id = asset.id)
  or exists (select 1 from storefront_content x where asset.id = any (x.asset_ids))
  or exists (select 1 from storefront_content_translation x where asset.id = any (x.asset_ids))));

-- The Shop API's cache version moves with every change a shopper could see (0064).
do $$
declare
  t text;
begin
  foreach t in array array['storefront_content', 'storefront_content_translation'] loop
    execute format('create trigger %I after insert on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_insert', t);
    execute format('create trigger %I after update on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_update', t);
    execute format('create trigger %I after delete on %I referencing old table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_delete', t);
  end loop;
end
$$;
