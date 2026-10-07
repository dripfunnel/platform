-- SAPI 8 (#306): shoppers get their own database role, app_shop (DATA-MODEL §5.3, §7.11), reading only the catalogue a
-- storefront shows; each store's storefront row carries its public key and the catalogue version the edge cache keys on.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_shop') then
    create role app_shop nologin;
  end if;
end
$$;

-- Whoever may become app_request (the Worker's login) may become app_shop, as 0047 did for suppliers.
do $$
declare
  login text;
begin
  for login in select m.member::regrole::text from pg_auth_members m where m.roleid = 'app_request'::regrole loop
    execute format('grant app_shop to %s', login);
  end loop;
end
$$;

grant usage on schema public to app_shop;

-- DATA-MODEL §7.8's storefront, with the columns this card needs; publishing (SAPI 17) adds the rest.
create table storefront (
  store_id uuid primary key references store (id),
  -- The one credential a browser may hold (ACCESS §2): it names the store and grants nothing.
  public_store_key text not null unique check (public_store_key ~ '^pk_[0-9a-f]{32}$'),
  -- Moves on every change a storefront shows, so a cached catalogue answer from before it is never served again.
  catalog_version bigint not null default 1,
  created_at timestamptz not null default now()
);

create function storefront_for_store() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into storefront (store_id, public_store_key) values (new.id, 'pk_' || replace(gen_random_uuid()::text, '-', ''));
  return new;
end
$$;
grant insert on storefront to app_definer;
alter function storefront_for_store() owner to app_definer;
create trigger storefront_for_store after insert on store for each row execute function storefront_for_store();
insert into storefront (store_id, public_store_key) select id, 'pk_' || replace(gen_random_uuid()::text, '-', '') from store;

-- The catalogue version moves with every statement that changes what a storefront shows, once per store it touched.
create function storefront_catalog_touched() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update storefront set catalog_version = catalog_version + 1 where store_id in (select distinct store_id from touched_rows);
  return null;
end
$$;

create function storefront_store_touched() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update storefront set catalog_version = catalog_version + 1 where store_id = new.id;
  return null;
end
$$;
grant select (store_id, catalog_version), update (catalog_version) on storefront to app_definer;
alter function storefront_catalog_touched() owner to app_definer;
alter function storefront_store_touched() owner to app_definer;

do $$
declare
  t text;
begin
  foreach t in array array[
    'product', 'product_option', 'product_option_value', 'product_version', 'product_version_option_value', 'version_price',
    'product_photo', 'product_video', 'product_market_rule', 'product_flag', 'product_compliance', 'product_spec',
    'product_highlight', 'product_faq', 'product_related', 'product_badge', 'product_filter_value', 'product_story',
    'story_block', 'size_chart', 'collection', 'collection_product', 'filter', 'filter_value', 'menu', 'menu_item', 'badge',
    'translation', 'store_language', 'store_currency', 'market', 'market_excluded_product'
  ] loop
    execute format('create trigger %I after insert on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_insert', t);
    execute format('create trigger %I after update on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_update', t);
    execute format('create trigger %I after delete on %I referencing old table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_delete', t);
  end loop;
end
$$;
create trigger store_touch after update of name, description, logo_asset_id, address, contact_email, contact_phone, time_zone, unit_system,
  pricing_currency, main_language, tax_inclusive, status on store for each row execute function storefront_store_touched();

-- The merchant side reads its key (Settings › Developers, SAPI 20); the Shop API finds a store by it in system scope.
grant select on storefront to app_request;
grant select, insert, update on storefront to app_system;
alter table storefront enable row level security;
alter table storefront force row level security;
create policy storefront_system on storefront for all to app_system using (true) with check (true);
create policy storefront_merchant on storefront for select to app_request
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
create policy request_scope on storefront as restrictive for all to app_request
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform')) with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on storefront as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on storefront as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on storefront as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');

-- What a shopper reads (DATA-MODEL §7.11): the public columns only, never a supplier id, cost, draft, note or code.
grant select (id, name, country, description, logo_asset_id, address, contact_email, contact_phone, time_zone, unit_system,
  pricing_currency, main_language, tax_inclusive, status) on store to app_shop;
grant select (store_id, language, status, position) on store_language to app_shop;
grant select (store_id, currency, mode, rounding, status, position) on store_currency to app_shop;
grant select (id, store_id, parent_id, name, is_primary, is_fallback, countries, currency, language, price_adjustment_bps, web_mode,
  path_prefix, products, status, position, deleted_at) on market to app_shop;
grant select on market_excluded_product, exchange_rate to app_shop;
grant select (id, store_id, name, slug, description, product_type, category, visibility, approval_status, hidden_by, publish_at,
  related_mode, warranty_text, returns_text, is_sample, seo_title, seo_description, search, created_at, updated_at, deleted_at,
  size_chart_id) on product to app_shop;
grant select (id, product_id, store_id, name, position) on product_option to app_shop;
grant select (id, option_id, store_id, name, position) on product_option_value to app_shop;
grant select (id, product_id, store_id, sku, barcode, name, visibility, weight_grams, length_mm, width_mm, height_mm, track_stock,
  continue_selling, position, created_at, updated_at, deleted_at) on product_version to app_shop;
grant select (version_id, option_id, value_id, store_id) on product_version_option_value to app_shop;
grant select (version_id, store_id, currency, amount, compare_at_amount) on version_price to app_shop;
grant select (id, product_id, version_id, store_id, asset_id, position, alt) on product_photo to app_shop;
grant select (product_id, store_id, asset_id, url) on product_video to app_shop;
grant select (product_id, store_id, mode, countries) on product_market_rule to app_shop;
grant select (product_id, store_id, age_restricted, hazardous) on product_flag to app_shop;
grant select (product_id, store_id, region, field, value) on product_compliance to app_shop;
grant select (id, product_id, version_id, store_id, name, value, filter_value_id, position) on product_spec to app_shop;
grant select (id, product_id, store_id, text, position) on product_highlight to app_shop;
grant select (id, product_id, store_id, question, answer, position) on product_faq to app_shop;
grant select (product_id, related_product_id, store_id, position) on product_related to app_shop;
grant select (product_id, badge_id, store_id) on product_badge to app_shop;
grant select (product_id, version_id, filter_value_id, store_id) on product_filter_value to app_shop;
grant select (product_id, store_id, template, live, published_at, asset_ids, product_ids, block_ids) on product_story to app_shop;
grant select (id, store_id, kind, name, content, asset_ids) on story_block to app_shop;
grant select (id, store_id, name, unit, systems, measurements, rows, how_to_measure, fit_notes, model_info, deleted_at) on size_chart to app_shop;
grant select (id, store_id, name, slug, description, kind, parent_id, visibility, image_asset_id, sort, seo_title, seo_description,
  created_at, updated_at, deleted_at) on collection to app_shop;
grant select (collection_id, product_id, store_id, position) on collection_product to app_shop;
grant select (id, store_id, name, position, shopper_visible) on filter to app_shop;
grant select (id, filter_id, store_id, name, position) on filter_value to app_shop;
grant select (id, store_id, key, name) on menu to app_shop;
grant select (id, menu_id, store_id, parent_id, label, kind, collection_id, url, position) on menu_item to app_shop;
grant select (id, store_id, label, tone, rule, position) on badge to app_shop;
grant select (store_id, entity, entity_id, field, language, text) on translation to app_shop;
grant select (id, store_id, kind, mime, bytes, width, height, r2_key) on asset to app_shop;
grant select (id, store_id, email, email_verified_at, phone, phone_verified_at, name, status, created_at) on customer to app_shop;
-- The cart's delivery quote (SAPI 23, #305): what the shopper pays, the couriers that price it and a market's own charge;
-- whether the store delivers to a postcode only through store_delivers_to(), never the list (§7.11).
grant select (store_id, courier_enabled, flat_enabled, flat_amount, pickup_enabled, pickup_hours, free_mode, free_threshold_amount, currency,
  area_mode, saved_at) on store_shipping to app_shop;
grant select (store_id, provider, role, position) on store_courier to app_shop;
grant select (delivery_amount) on market to app_shop;
grant execute on function store_delivers_to(text) to app_shop;
-- A shopper's own entries (LOGGING §6: visibility self), as 0006's shop branch reads them.
grant select on activity_log to app_shop;

do $$
declare
  shop constant text := 'app_setting_text(''app.scope'') = ''shop'' and store_id = app_setting_uuid(''app.store_id'')';
  product_seen constant text := 'exists (select 1 from product p where p.id = product_id)';
  -- Visible, not deleted, hidden by nothing, approved, its publishing time come, never a sample.
  visible constant text := 'deleted_at is null and visibility = ''visible'' and hidden_by is null and coalesce(approval_status, ''approved'') = ''approved''
    and (publish_at is null or publish_at <= now()) and not is_sample';
  rule record;
  pin record;
begin
  for rule in select * from (values
    ('store_language', 'status = ''active'''),
    ('store_currency', 'status = ''active'''),
    ('market', 'deleted_at is null and status = ''active'''),
    ('market_excluded_product', 'true'),
    ('product', visible),
    ('product_option', product_seen),
    ('product_option_value', 'exists (select 1 from product_option o where o.id = option_id)'),
    ('product_version', 'deleted_at is null and visibility = ''visible'' and ' || product_seen),
    ('product_version_option_value', 'exists (select 1 from product_version v where v.id = version_id)'),
    ('version_price', 'exists (select 1 from product_version v where v.id = version_id)'),
    ('product_photo', product_seen || ' and (version_id is null or exists (select 1 from product_version v where v.id = version_id))'),
    ('product_video', product_seen),
    ('product_market_rule', product_seen),
    ('product_flag', product_seen),
    ('product_compliance', product_seen),
    ('product_spec', product_seen),
    ('product_highlight', product_seen),
    ('product_faq', product_seen),
    ('product_related', product_seen || ' and exists (select 1 from product r where r.id = related_product_id)'),
    ('product_badge', product_seen),
    ('product_filter_value', product_seen),
    ('product_story', 'live is not null and ' || product_seen),
    ('story_block', 'exists (select 1 from product_story s where story_block.id = any (s.block_ids))'),
    ('size_chart', 'deleted_at is null and exists (select 1 from product p where p.size_chart_id = size_chart.id)'),
    ('collection', 'deleted_at is null and visibility = ''visible'''),
    ('collection_product', 'exists (select 1 from collection c where c.id = collection_id) and ' || product_seen),
    ('filter', 'shopper_visible'),
    ('filter_value', 'exists (select 1 from filter f where f.id = filter_id)'),
    ('menu', 'true'),
    ('store_shipping', 'true'),
    ('store_courier', 'true'),
    ('menu_item', 'true'),
    ('badge', 'true'),
    ('translation', 'case entity
       when ''product'' then exists (select 1 from product p where p.id::text = entity_id)
       when ''version'' then exists (select 1 from product_version v where v.id::text = entity_id)
       when ''collection'' then exists (select 1 from collection c where c.id::text = entity_id)
       when ''filter'' then exists (select 1 from filter f where f.id::text = entity_id)
       when ''filter_value'' then exists (select 1 from filter_value v where v.id::text = entity_id)
       else true end'),
    ('asset', 'exists (select 1 from product_photo x where x.asset_id = asset.id)
       or exists (select 1 from product_video x where x.asset_id = asset.id)
       or exists (select 1 from collection x where x.image_asset_id = asset.id)
       or exists (select 1 from product_story x where asset.id = any (x.asset_ids))
       or exists (select 1 from story_block x where asset.id = any (x.asset_ids))
       or exists (select 1 from store x where x.logo_asset_id = asset.id)')
  ) as r(t, rule) loop
    execute format('create policy %I on %I for select to app_shop using (%s and (%s))', rule.t || '_shop', rule.t, shop, rule.rule);
  end loop;

  -- Each table app_shop reads holds it to shop scope, whatever app.scope says (api/README.md §7).
  for pin in
    select tablename, roles, qual, with_check from pg_policies
    where schemaname = 'public' and policyname = 'request_scope' and tablename in (
      'store', 'store_language', 'store_currency', 'market', 'market_excluded_product', 'exchange_rate', 'product', 'product_option',
      'product_option_value', 'product_version', 'product_version_option_value', 'version_price', 'product_photo', 'product_video',
      'product_market_rule', 'product_flag', 'product_compliance', 'product_spec', 'product_highlight', 'product_faq', 'product_related',
      'product_badge', 'product_filter_value', 'product_story', 'story_block', 'size_chart', 'collection', 'collection_product', 'filter',
      'filter_value', 'menu', 'menu_item', 'badge', 'translation', 'asset', 'customer', 'activity_log', 'store_shipping', 'store_courier')
  loop
    execute format('alter policy request_scope on %I to %s using ((%s) and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop'')) with check ((%s) and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))',
      pin.tablename, (select string_agg(format('%I', r), ', ') from unnest(array_append(pin.roles::text[], 'app_shop')) r), pin.qual, coalesce(pin.with_check, pin.qual));
  end loop;
end
$$;

create policy store_shop on store for select to app_shop using (app_setting_text('app.scope') = 'shop' and id = app_setting_uuid('app.store_id'));
alter policy exchange_rate_read on exchange_rate to app_request, app_shop;
-- A shopper's own customer row, as the shop branch of 0003 already reads it for app_request.
alter policy customer_read on customer to app_request, app_platform, app_shop;
alter policy activity_log_read on activity_log to app_partner, app_platform, app_request, app_supplier, app_system, app_shop;

create index product_photo_asset_idx on product_photo (asset_id);
create index product_video_asset_idx on product_video (asset_id) where asset_id is not null;
