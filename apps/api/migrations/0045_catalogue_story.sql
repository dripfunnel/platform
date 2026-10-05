-- SAPI 3, part 5 (#293): A+ content (CATALOG Q), DATA-MODEL §7.3. `product_story` is store-and-seller with
-- 0041's tables; `story_block` is inside the store, the merchant's alone (§7.11).

create table story_block (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  kind text not null default 'brand_story' check (kind = 'brand_story'),
  name text not null check (char_length(name) between 1 and 80),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  asset_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (id, store_id)
);

create index story_block_store_idx on story_block (store_id, updated_at desc, id desc);

create table product_story (
  product_id uuid primary key,
  store_id uuid not null,
  seller_id uuid,
  template text check (template in ('fashion', 'electronics', 'home', 'beauty')),
  -- Ordered modules; the draft saves unfinished and reaches the page only when published (Q9).
  draft jsonb not null default '[]' check (jsonb_typeof(draft) = 'array'),
  live jsonb check (jsonb_typeof(live) = 'array'),
  published_at timestamptz,
  -- What the two documents name, kept by the trigger below so "used on" and file ownership are queries.
  asset_ids uuid[] not null default '{}',
  product_ids uuid[] not null default '{}',
  block_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  foreign key (product_id, store_id) references product (id, store_id),
  foreign key (seller_id, store_id) references seller (id, store_id)
);

create index product_story_assets_idx on product_story using gin (asset_ids);
create index product_story_blocks_idx on product_story using gin (block_ids);

create trigger product_story_owner before insert or update on product_story for each row execute function catalogue_owner_from_product();

-- Moves an unshared file to the owner of the row that now shows it, as 0042's photos do; a file another
-- owner already shows stays theirs.
create function catalogue_claim_assets(store uuid, owner uuid, ids uuid[], self_product uuid, self_block uuid) returns void
language plpgsql
as $$
begin
  if exists (select 1 from asset a where a.id = any (ids) and a.seller_id is distinct from owner
             and (exists (select 1 from product_photo p where p.asset_id = a.id and p.product_id is distinct from self_product)
                  or exists (select 1 from product_video v where v.asset_id = a.id and v.product_id is distinct from self_product)
                  or exists (select 1 from product_story s where a.id = any (s.asset_ids) and s.product_id is distinct from self_product)
                  or exists (select 1 from story_block b where a.id = any (b.asset_ids) and b.id is distinct from self_block))) then
    raise exception 'catalogue: that file is another owner''s' using errcode = '42501';
  end if;
  update asset set seller_id = owner where id = any (ids) and store_id = store and seller_id is distinct from owner;
end
$$;

-- Every file, product and block a story names is one the caller reads in this store, so a supplier's
-- story never names what its supplier can't read (ACCESS §7.1).
create function product_story_check() returns trigger
language plpgsql
as $$
declare
  doc jsonb := new.draft || coalesce(new.live, '[]');
  videos uuid[];
  added uuid[];
begin
  new.asset_ids := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $.**.assetId') v where jsonb_typeof(v) = 'string');
  new.product_ids := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $[*].productIds[*]') v);
  new.block_ids := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $[*].blockId') v where jsonb_typeof(v) = 'string');
  videos := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(doc, 'lax $[*] ? (@.kind == "video").video.assetId') v where jsonb_typeof(v) = 'string');

  if (select count(*) from asset a where a.id = any (new.asset_ids) and a.store_id = new.store_id
        and a.kind = case when a.id = any (videos) then 'video' else 'image' end) <> cardinality(new.asset_ids) then
    raise exception 'catalogue: a story names a file that isn''t here or is the wrong kind' using errcode = '23503';
  end if;
  -- Only a product the save adds is checked, so trashing a compared product never blocks the story's next save.
  added := array(select unnest(new.product_ids) except select unnest(case when tg_op = 'UPDATE' then old.product_ids else '{}' end));
  if new.product_id = any (new.product_ids)
     or (select count(*) from product p where p.id = any (added) and p.store_id = new.store_id and p.deleted_at is null
           and (new.seller_id is null or p.seller_id is not distinct from new.seller_id)) <> cardinality(added) then
    raise exception 'catalogue: a story compares a product it can''t' using errcode = '23503';
  end if;
  -- A brand story is the merchant's, so only the merchant's products carry one (Q5).
  if cardinality(new.block_ids) > 0 and (new.seller_id is not null
     or (select count(*) from story_block b where b.id = any (new.block_ids) and b.store_id = new.store_id) <> cardinality(new.block_ids)) then
    raise exception 'catalogue: a story names a brand story it can''t' using errcode = '23503';
  end if;
  perform catalogue_claim_assets(new.store_id, new.seller_id, new.asset_ids, new.product_id, null);
  return new;
end
$$;

-- Named to run after `product_story_owner`, which sets the owner it checks against.
create trigger product_story_zcheck before insert or update on product_story for each row execute function product_story_check();

create function story_block_check() returns trigger
language plpgsql
as $$
begin
  new.asset_ids := array(select distinct (v #>> '{}')::uuid from jsonb_path_query(new.content, 'lax $.**.assetId') v where jsonb_typeof(v) = 'string');
  if (select count(*) from asset a where a.id = any (new.asset_ids) and a.store_id = new.store_id and a.kind = 'image') <> cardinality(new.asset_ids) then
    raise exception 'catalogue: a brand story names a file that isn''t here or is the wrong kind' using errcode = '23503';
  end if;
  perform catalogue_claim_assets(new.store_id, null, new.asset_ids, null, new.id);
  return new;
end
$$;

create trigger story_block_check before insert or update on story_block for each row execute function story_block_check();

-- 0042's photo and video links also count a story or brand story already showing the file.
create or replace function catalogue_link_asset() returns trigger
language plpgsql
as $$
begin
  if new.asset_id is null then
    return new;
  end if;
  if not exists (select 1 from asset a where a.id = new.asset_id and a.store_id = new.store_id) then
    raise exception 'catalogue: no such file in this store' using errcode = '23503';
  end if;
  if not exists (select 1 from asset a where a.id = new.asset_id and a.kind = case tg_table_name when 'product_photo' then 'image' else 'video' end) then
    raise exception 'catalogue: that file is the wrong kind for a %', tg_table_name using errcode = '23514';
  end if;
  if exists (select 1 from asset a where a.id = new.asset_id and a.seller_id is distinct from new.seller_id)
     and (exists (select 1 from product_photo p where p.asset_id = new.asset_id and p.product_id <> new.product_id)
          or exists (select 1 from product_video v where v.asset_id = new.asset_id and v.product_id <> new.product_id)
          or exists (select 1 from product_story s where new.asset_id = any (s.asset_ids) and s.product_id <> new.product_id)
          or exists (select 1 from story_block b where new.asset_id = any (b.asset_ids))) then
    raise exception 'catalogue: that file is another owner''s' using errcode = '42501';
  end if;
  update asset set seller_id = new.seller_id where id = new.asset_id and seller_id is distinct from new.seller_id;
  return new;
end
$$;

grant select, insert on product_story to app_request;
grant update (template, draft, live, published_at, asset_ids, product_ids, block_ids, updated_at, revision) on product_story to app_request;
grant select, insert, delete on story_block to app_request;
grant update (name, content, asset_ids, updated_at, revision) on story_block to app_request;
grant select, insert, update, delete on product_story, story_block to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['product_story', 'story_block'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
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

create policy product_story_store on product_story for all to app_request
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')))
  with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')));

create policy story_block_merchant on story_block for all to app_request
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '')
  with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id') and app_setting_text('app.seller_id') = '');
