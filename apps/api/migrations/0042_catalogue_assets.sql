-- SAPI 3, part 2 (#293): uploaded files and a product's photos and video, DATA-MODEL §7.3. Store-and-seller
-- class (§7.11), as 0041's tables; the shop's branches come with the Shop API.

create table asset (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  -- The owner of the row that uses it, set when linked; an unlinked upload is its uploader's (§7.3).
  seller_id uuid,
  r2_key text not null unique check (r2_key ~ '^stores/[0-9a-f-]{36}/assets/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'),
  kind text not null check (kind in ('image', 'video', 'file', 'document')),
  mime text not null check (char_length(mime) <= 100),
  bytes integer not null check (bytes > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (seller_id, store_id) references seller (id, store_id)
);

create unique index asset_id_store_key on asset (id, store_id);
create index asset_store_idx on asset (store_id, seller_id, created_at desc);

create table product_photo (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  version_id uuid,
  store_id uuid not null,
  seller_id uuid,
  asset_id uuid not null,
  position integer not null check (position >= 0),
  alt text check (char_length(alt) <= 250),
  created_at timestamptz not null default now(),
  foreign key (product_id, store_id) references product (id, store_id),
  foreign key (version_id, store_id) references product_version (id, store_id),
  foreign key (asset_id, store_id) references asset (id, store_id)
);

create index product_photo_product_idx on product_photo (product_id, position);
create unique index product_photo_asset_key on product_photo (product_id, asset_id);

-- One per product (CATALOG F9, S7): an uploaded file or a link to a video host.
create table product_video (
  product_id uuid primary key,
  store_id uuid not null,
  seller_id uuid,
  asset_id uuid,
  url text check (url ~ '^https://' and char_length(url) <= 500),
  foreign key (product_id, store_id) references product (id, store_id),
  foreign key (asset_id, store_id) references asset (id, store_id),
  check ((asset_id is null) <> (url is null))
);

-- The uploader's own scope owns an unlinked file: a supplier can't upload one in the merchant's name.
create function asset_owner_on_upload() returns trigger
language plpgsql
as $$
begin
  if app_setting_text('app.seller_id') <> '' and new.seller_id is distinct from app_setting_uuid('app.seller_id') then
    raise exception 'catalogue: a supplier uploads as itself' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger asset_owner_on_upload before insert on asset for each row execute function asset_owner_on_upload();

-- A photo or video names a file the caller can read (a foreign key alone would accept another owner's
-- id), and the file becomes the product owner's, so the product's supplier reads it (§7.3 asset).
create function catalogue_link_asset() returns trigger
language plpgsql
as $$
begin
  if new.asset_id is null then
    return new;
  end if;
  if not exists (select 1 from asset a where a.id = new.asset_id and a.store_id = new.store_id) then
    raise exception 'catalogue: no such file in this store' using errcode = '23503';
  end if;
  -- A photo is an image and a video a video, whatever id the request names.
  if not exists (select 1 from asset a where a.id = new.asset_id and a.kind = case tg_table_name when 'product_photo' then 'image' else 'video' end) then
    raise exception 'catalogue: that file is the wrong kind for a %', tg_table_name using errcode = '23514';
  end if;
  -- A file already in use by another owner's product stays theirs: moving it would hide their photo.
  if exists (select 1 from asset a where a.id = new.asset_id and a.seller_id is distinct from new.seller_id)
     and (exists (select 1 from product_photo p where p.asset_id = new.asset_id and p.product_id <> new.product_id)
          or exists (select 1 from product_video v where v.asset_id = new.asset_id and v.product_id <> new.product_id)) then
    raise exception 'catalogue: that file is another owner''s' using errcode = '42501';
  end if;
  update asset set seller_id = new.seller_id where id = new.asset_id and seller_id is distinct from new.seller_id;
  return new;
end
$$;

-- The owner first (0041's trigger, alphabetically before this one), then the file it links.
create trigger product_photo_owner before insert or update on product_photo for each row execute function catalogue_owner_from_product();
create trigger product_photo_zlink before insert or update on product_photo for each row execute function catalogue_link_asset();
create trigger product_video_owner before insert or update on product_video for each row execute function catalogue_owner_from_product();
create trigger product_video_zlink before insert or update on product_video for each row execute function catalogue_link_asset();

-- A version's photo belongs to the same product.
create function product_photo_version_check() returns trigger
language plpgsql
as $$
begin
  if new.version_id is not null and not exists (select 1 from product_version v where v.id = new.version_id and v.product_id = new.product_id) then
    raise exception 'catalogue: that version is another product''s' using errcode = '23503';
  end if;
  return new;
end
$$;

create trigger product_photo_version before insert or update on product_photo for each row execute function product_photo_version_check();

grant select, insert on asset, product_photo, product_video to app_request;
grant update (seller_id) on asset to app_request;
grant update (version_id, position, alt) on product_photo to app_request;
grant update (asset_id, url) on product_video to app_request;
grant delete on product_photo, product_video to app_request;
grant select, insert, update, delete on asset, product_photo, product_video to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['asset', 'product_photo', 'product_video'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))', t || '_store', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request
      using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))
      with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy support_no_insert on %I as restrictive for insert to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_update on %I as restrictive for update to app_request with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_delete on %I as restrictive for delete to app_request using (app_setting_text(''app.support'') <> ''read'')', t);
  end loop;
end
$$;
