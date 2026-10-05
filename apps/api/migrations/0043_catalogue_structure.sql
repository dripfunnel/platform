-- SAPI 3, part 3 (#293): collections, filters and menus, DATA-MODEL §7.3. "Catalogue structure" class of
-- §7.11 (inside the store, merchant-written; a supplier reads filters to tag its own products), and
-- product_filter_value in the store-and-seller class with 0041's tables.

create table filter (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null check (char_length(name) between 1 and 60),
  position integer not null check (position >= 0),
  -- An internal tag only the team sees is a filter shoppers don't (CATALOG I1).
  shopper_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index filter_id_store_key on filter (id, store_id);
create unique index filter_name_key on filter (store_id, lower(name));

create table filter_value (
  id uuid primary key default gen_random_uuid(),
  filter_id uuid not null,
  store_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  foreign key (filter_id, store_id) references filter (id, store_id) on delete cascade
);

create unique index filter_value_id_store_key on filter_value (id, store_id);
create unique index filter_value_name_key on filter_value (filter_id, lower(name));

-- On the product or one version (fact 13); the product's owner, copied from it as 0041's children are.
create table product_filter_value (
  product_id uuid not null,
  version_id uuid,
  filter_value_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  foreign key (product_id, store_id) references product (id, store_id),
  foreign key (version_id, store_id) references product_version (id, store_id),
  foreign key (filter_value_id, store_id) references filter_value (id, store_id) on delete cascade,
  unique nulls not distinct (product_id, version_id, filter_value_id)
);

create index product_filter_value_value_idx on product_filter_value (store_id, filter_value_id, product_id);

create table collection (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  description text not null default '' check (char_length(description) <= 5000),
  kind text not null check (kind in ('manual', 'automatic')),
  match text not null default 'all' check (match in ('all', 'any')),
  parent_id uuid,
  inherit_parent boolean not null default false,
  visibility text not null default 'visible' check (visibility in ('visible', 'hidden')),
  image_asset_id uuid,
  sort text not null default 'manual' check (sort in ('manual', 'newest', 'price_asc', 'price_desc', 'best_selling')),
  seo_title text check (char_length(seo_title) <= 120),
  seo_description text check (char_length(seo_description) <= 320),
  -- When the rules' result last landed (fact 11: "Updating…" until then), and how many products matched,
  -- which can pass the products it holds (maxCollectionProducts), so a cut is shown, never silent.
  computed_at timestamptz,
  rule_matches integer check (rule_matches >= 0),
  created_at timestamptz not null default date_trunc('milliseconds', now()), -- as a list cursor carries it (core/cursor.ts)
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  deleted_at timestamptz,
  foreign key (image_asset_id, store_id) references asset (id, store_id)
);

create unique index collection_id_store_key on collection (id, store_id);
alter table collection add foreign key (parent_id, store_id) references collection (id, store_id);
create unique index collection_slug_key on collection (store_id, slug) where deleted_at is null;
create index collection_list_idx on collection (store_id, created_at desc, id desc) where deleted_at is null;

create table collection_rule (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null,
  store_id uuid not null,
  kind text not null check (kind in ('filter_value', 'name_contains', 'product', 'version', 'price_range')),
  args jsonb not null,
  position integer not null check (position >= 0),
  foreign key (collection_id, store_id) references collection (id, store_id) on delete cascade
);

create index collection_rule_collection_idx on collection_rule (collection_id, position);

create table collection_product (
  collection_id uuid not null,
  product_id uuid not null,
  store_id uuid not null,
  position integer not null check (position >= 0),
  source text not null check (source in ('manual', 'rule')),
  computed_at timestamptz not null default now(),
  primary key (collection_id, product_id),
  foreign key (collection_id, store_id) references collection (id, store_id) on delete cascade,
  foreign key (product_id, store_id) references product (id, store_id)
);

create index collection_product_product_idx on collection_product (store_id, product_id);

create table menu (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references store (id),
  key text not null check (key = 'main'),
  name text not null check (char_length(name) between 1 and 60),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (store_id, key)
);

create unique index menu_id_store_key on menu (id, store_id);

create table menu_item (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null,
  store_id uuid not null,
  parent_id uuid references menu_item (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  kind text not null check (kind in ('collection', 'page', 'url')),
  collection_id uuid,
  url text check (char_length(url) <= 500),
  position integer not null check (position >= 0),
  foreign key (menu_id, store_id) references menu (id, store_id) on delete cascade,
  foreign key (collection_id, store_id) references collection (id, store_id),
  -- A collection item names one; a page is a path on the shop; a link is https (J4).
  check ((kind = 'collection') = (collection_id is not null)),
  check (kind <> 'page' or url ~ '^/[a-z0-9/_-]*$'),
  check (kind <> 'url' or url ~ '^https://'),
  check (kind = 'collection' or url is not null)
);

-- One level of nesting (FIRST-RELEASE §12): an item's parent is a top-level item of the same menu.
create function menu_item_depth() returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null and not exists (select 1 from menu_item p where p.id = new.parent_id and p.menu_id = new.menu_id and p.parent_id is null) then
    raise exception 'catalogue: a menu nests one level, in its own menu' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger menu_item_depth before insert or update on menu_item for each row execute function menu_item_depth();

-- A child collection's parent is another collection of the store, never itself or below it.
create function collection_parent_check() returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null and exists (
    with recursive up as (
      select c.id, c.parent_id from collection c where c.id = new.parent_id
      union all
      select c.id, c.parent_id from collection c join up on c.id = up.parent_id
    ) select 1 from up where up.id = new.id
  ) then
    raise exception 'catalogue: a collection can''t sit inside itself' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger collection_parent_check before insert or update of parent_id on collection for each row execute function collection_parent_check();

create trigger product_filter_value_owner before insert or update on product_filter_value for each row execute function catalogue_owner_from_product();

grant select, insert, update, delete on filter, filter_value, collection, collection_rule, collection_product, menu, menu_item to app_request;
grant select, insert, delete on product_filter_value to app_request;
grant select, insert, update, delete on filter, filter_value, product_filter_value, collection, collection_rule, collection_product, menu, menu_item to app_system;

do $$
declare
  t text;
begin
  foreach t in array array['filter', 'filter_value', 'product_filter_value', 'collection', 'collection_rule', 'collection_product', 'menu', 'menu_item'] loop
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

  -- The merchant side writes the structure; no supplier branch on collections or menus (CATALOG L9, #337).
  foreach t in array array['filter', 'filter_value', 'collection', 'collection_rule', 'collection_product', 'menu', 'menu_item'] loop
    execute format('create policy %I on %I for all to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'') and app_setting_text(''app.seller_id'') = '''')', t || '_merchant', t);
  end loop;

  -- A supplier reads the filters and their values to tag its own products, and writes neither (§7.11).
  foreach t in array array['filter', 'filter_value'] loop
    execute format('create policy %I on %I for select to app_request
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id''))', t || '_supplier_read', t);
  end loop;
end
$$;

create policy product_filter_value_store on product_filter_value for all to app_request
  using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')))
  with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
    and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')));
