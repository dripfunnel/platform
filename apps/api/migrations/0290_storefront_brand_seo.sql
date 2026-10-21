-- SAPI 17b (#471), part 1: the brand and the home page's search and sharing (DATA-MODEL §7.8; SAAS §9.2), read by the
-- Shop API for core's useStorefront() (storefront ARCHITECTURE §2.1). Nothing here is destructive: two new tables, a
-- function and a widened policy.

-- "Your brand" and Site settings › Brand. The colours and the voice are only hints to the AI: the Shop API never reads them.
create table storefront_brand (
  store_id uuid primary key references store (id),
  logo_asset_id uuid not null,
  favicon_asset_id uuid,
  primary_colour text check (primary_colour ~ '^#[0-9a-f]{6}$'),
  secondary_colour text check (secondary_colour ~ '^#[0-9a-f]{6}$'),
  tagline text check (char_length(tagline) between 1 and 100),
  description text check (char_length(description) between 1 and 300),
  -- Each network's https address on its own host, keyed by network (saas/storefrontSettings).
  social jsonb not null default '{}' check (jsonb_typeof(social) = 'object'),
  contact_email text check (char_length(contact_email) <= 320),
  contact_phone text check (char_length(contact_phone) <= 40),
  contact_address jsonb check (jsonb_typeof(contact_address) = 'object'),
  voice text check (char_length(voice) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (logo_asset_id, store_id) references asset (id, store_id),
  foreign key (favicon_asset_id, store_id) references asset (id, store_id)
);

-- The home page's title and description in search results, and the image shown when it is shared.
create table storefront_seo (
  store_id uuid primary key references store (id),
  title text check (char_length(title) between 1 and 60),
  description text check (char_length(description) between 1 and 155),
  share_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (share_asset_id, store_id) references asset (id, store_id)
);

grant select, insert, update on storefront_brand, storefront_seo to app_request;
grant select, insert, update, delete on storefront_brand, storefront_seo to app_system;
-- What a shopper may see (DATA-MODEL §7.11): never the colours or the voice.
grant select (store_id, logo_asset_id, favicon_asset_id, tagline, description, social, contact_email, contact_phone, contact_address) on storefront_brand to app_shop;
grant select (store_id, title, description, share_asset_id) on storefront_seo to app_shop;

do $$
declare
  t text;
begin
  foreach t in array array['storefront_brand', 'storefront_seo'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    -- The merchant side of its own store; never a supplier (ACCESS §5.1 `publish`, `storefront.read`).
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
    execute format('create policy %I on %I for select to app_shop
      using (app_setting_text(''app.scope'') = ''shop'' and store_id = app_setting_uuid(''app.store_id''))', t || '_shop', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request, app_shop
      using (app_setting_text(''app.scope'') in (''store'', ''shop'') and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))
      with check (app_setting_text(''app.scope'') = ''store'' and current_user <> ''app_shop'')', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy support_no_insert on %I as restrictive for insert to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_update on %I as restrictive for update to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_delete on %I as restrictive for delete to app_request using (app_setting_text(''app.support'') <> ''read'')', t);
    -- The Shop API's cache version moves with every change a shopper could see (0064).
    execute format('create trigger %I after insert on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_insert', t);
    execute format('create trigger %I after update on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_update', t);
  end loop;
end
$$;

-- The brand's logo and favicon and the share image are files a shopper may fetch, as the store's logo is (0271).
alter policy asset_shop on asset using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and (
  exists (select 1 from product_photo x where x.asset_id = asset.id)
  or exists (select 1 from product_video x where x.asset_id = asset.id)
  or exists (select 1 from collection x where x.image_asset_id = asset.id)
  or exists (select 1 from product_story x where asset.id = any (x.asset_ids))
  or exists (select 1 from story_block x where asset.id = any (x.asset_ids))
  or exists (select 1 from store x where x.logo_asset_id = asset.id)
  or exists (select 1 from storefront_content x where asset.id = any (x.asset_ids))
  or exists (select 1 from storefront_content_translation x where asset.id = any (x.asset_ids))
  or exists (select 1 from storefront_brand x where asset.id in (x.logo_asset_id, x.favicon_asset_id))
  or exists (select 1 from storefront_seo x where x.share_asset_id = asset.id)));

-- The brand step's shop name (storefront DESIGN §4 step 1) is Store info's: the merchant side changes that one column here.
create function save_store_name(p_name text) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_setting_text('app.scope') <> 'store' or app_setting_text('app.seller_id') <> '' or app_setting_text('app.support') = 'read' then
    raise exception 'save_store_name: the merchant side of a store only' using errcode = '42501';
  end if;
  update store set name = p_name where id = app_setting_uuid('app.store_id');
end
$$;
alter function save_store_name(text) owner to app_definer;
revoke execute on function save_store_name(text) from public;
grant execute on function save_store_name(text) to app_request;
