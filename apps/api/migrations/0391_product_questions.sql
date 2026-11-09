-- Product customisation (#1368; DATA-MODEL §7.3, §7.7, §7.11; CATALOG-DESIGN facts 49–57): the questions a product asks
-- before it goes in the cart, their choices, their amounts and the versions they're shown for, and an offer's switch for
-- whether it discounts them. Children of product (§7.1): a supplier's carry its seller_id, copied by trigger.

create table product_question (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  kind text not null check (kind in ('choice', 'text', 'upload')),
  label text not null check (char_length(label) between 1 and 200),
  help text check (char_length(help) between 1 and 500),
  required boolean not null default false,
  position smallint not null check (position between 1 and 10),
  min_picks smallint,
  max_picks smallint,
  free_picks smallint,
  max_length smallint,
  multiline boolean,
  example text check (char_length(example) between 1 and 100),
  accept text check (accept in ('image', 'pdf', 'image_pdf')),
  max_files smallint,
  price_mode text check (price_mode in ('fixed', 'percent', 'per_character')),
  price_bps integer check (price_bps between 1 and 10000),
  price_per text check (price_per in ('item', 'line')),
  shown_if_choice_id uuid,
  unique (id, store_id),
  constraint product_question_position unique (product_id, position) deferrable initially deferred,
  foreign key (product_id, store_id) references product (id, store_id) on delete cascade,
  check (kind <> 'choice' or (min_picks between 0 and 99 and max_picks between 1 and 99 and min_picks <= max_picks
    and free_picks between 0 and max_picks and required = (min_picks >= 1)
    and max_length is null and multiline is null and example is null and accept is null and max_files is null and price_mode is null)),
  check (kind <> 'text' or (max_length between 1 and 500 and multiline is not null
    and min_picks is null and max_picks is null and free_picks is null and accept is null and max_files is null)),
  check (kind <> 'upload' or (accept is not null and max_files between 1 and 5 and price_mode is distinct from 'per_character'
    and min_picks is null and max_picks is null and free_picks is null and max_length is null and multiline is null and example is null)),
  check ((price_mode is null) = (price_per is null)),
  check ((price_mode is not distinct from 'percent') = (price_bps is not null))
);

create table product_question_choice (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null,
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  label text not null check (char_length(label) between 1 and 100),
  position smallint not null check (position between 1 and 50),
  available boolean not null default true,
  photo_asset_id uuid,
  max_quantity smallint not null default 1 check (max_quantity between 1 and 99),
  price_mode text check (price_mode in ('fixed', 'percent')),
  price_bps integer check (price_bps between 1 and 10000),
  price_per text check (price_per in ('item', 'line')),
  unique (id, store_id),
  constraint product_question_choice_position unique (question_id, position) deferrable initially deferred,
  foreign key (question_id, store_id) references product_question (id, store_id) on delete cascade,
  foreign key (photo_asset_id, store_id) references asset (id, store_id),
  check ((price_mode is null) = (price_per is null)),
  check ((price_mode is not distinct from 'percent') = (price_bps is not null))
);

-- The one condition (fact 54): a choice of another question of the same product, one level deep (the trigger below).
alter table product_question add foreign key (shown_if_choice_id) references product_question_choice (id) on delete set null;

create table product_question_amount (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_id uuid,
  product_id uuid not null,
  question_id uuid,
  choice_id uuid,
  version_id uuid,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  amount bigint not null check (amount >= 0 and amount < 1000000000000000),
  constraint product_question_amount_key unique nulls not distinct (question_id, choice_id, version_id, currency),
  foreign key (question_id, store_id) references product_question (id, store_id) on delete cascade,
  foreign key (choice_id, store_id) references product_question_choice (id, store_id) on delete cascade,
  foreign key (version_id, store_id) references product_version (id, store_id) on delete cascade,
  check (num_nonnulls(question_id, choice_id) = 1)
);

-- "Only for some versions" (fact 54): no rows is every version.
create table product_question_version (
  question_id uuid not null,
  version_id uuid not null,
  product_id uuid not null,
  store_id uuid not null,
  seller_id uuid,
  primary key (question_id, version_id),
  foreign key (question_id, store_id) references product_question (id, store_id) on delete cascade,
  foreign key (version_id, store_id) references product_version (id, store_id) on delete cascade
);

create index product_question_product_idx on product_question (store_id, seller_id, product_id, position);
create index product_question_choice_question_idx on product_question_choice (question_id, position);
create index product_question_choice_photo_idx on product_question_choice (photo_asset_id) where photo_asset_id is not null;
create index product_question_amount_question_idx on product_question_amount (question_id) where question_id is not null;
create index product_question_amount_choice_idx on product_question_amount (choice_id) where choice_id is not null;
create index product_question_amount_version_idx on product_question_amount (version_id) where version_id is not null;
create index product_question_version_version_idx on product_question_version (version_id);

-- §7.1: a child's owner and product are its question's (or its choice's), never input. As the caller, so a question it
-- can't read (another supplier's) refuses the write. A choice belongs to a choice list; a version and a condition's
-- choice to the same product.
create function product_question_child() returns trigger
language plpgsql
as $$
declare
  owner record;
begin
  if tg_table_name = 'product_question_amount' then
    if new.question_id is null then
      select c.store_id, c.seller_id, c.product_id, 'choice'::text as kind into owner from product_question_choice c where c.id = new.choice_id;
    else
      select q.store_id, q.seller_id, q.product_id, q.kind into owner from product_question q where q.id = new.question_id;
    end if;
  else
    select q.store_id, q.seller_id, q.product_id, q.kind into owner from product_question q where q.id = new.question_id;
  end if;
  if not found or owner.store_id is distinct from new.store_id then
    raise exception 'catalogue: no such question in this store' using errcode = '23503';
  end if;
  new.seller_id := owner.seller_id;
  new.product_id := owner.product_id;
  -- Nested, as PL/pgSQL resolves every field an expression names, on whichever table fired.
  if tg_table_name = 'product_question_choice' then
    if owner.kind <> 'choice' then
      raise exception 'catalogue: only a choice list has choices' using errcode = '23514';
    end if;
  elsif new.version_id is not null then
    if not exists (select 1 from product_version v where v.id = new.version_id and v.product_id = new.product_id) then
      raise exception 'catalogue: that version is another product''s' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create function product_question_condition() returns trigger
language plpgsql
as $$
begin
  if new.shown_if_choice_id is null then
    return new;
  end if;
  -- Another question of this product, itself shown always, and nothing shown by this one: one level deep.
  if not exists (
       select 1 from product_question_choice c join product_question q on q.id = c.question_id
       where c.id = new.shown_if_choice_id and q.product_id = new.product_id and q.id <> new.id and q.shown_if_choice_id is null)
     or exists (
       select 1 from product_question q join product_question_choice c on c.id = q.shown_if_choice_id
       where c.question_id = new.id) then
    raise exception 'catalogue: a question is shown by one choice of another, one level deep' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger product_question_owner before insert or update on product_question for each row execute function catalogue_owner_from_product();
create trigger product_question_zcondition before insert or update of shown_if_choice_id on product_question for each row execute function product_question_condition();
create trigger product_question_choice_owner before insert or update on product_question_choice for each row execute function product_question_child();
create trigger product_question_amount_owner before insert or update on product_question_amount for each row execute function product_question_child();
create trigger product_question_version_owner before insert or update on product_question_version for each row execute function product_question_child();

-- A choice's photo is a file of this store, an image, and becomes the product owner's as a product photo's does (0042).
create function product_question_choice_photo() returns trigger
language plpgsql
as $$
begin
  if new.photo_asset_id is null then
    return new;
  end if;
  if not exists (select 1 from asset a where a.id = new.photo_asset_id and a.store_id = new.store_id and a.kind = 'image') then
    raise exception 'catalogue: no such file in this store' using errcode = '23503';
  end if;
  if exists (select 1 from asset a where a.id = new.photo_asset_id and a.seller_id is distinct from new.seller_id)
     and (exists (select 1 from product_photo p where p.asset_id = new.photo_asset_id and p.product_id <> new.product_id)
          or exists (select 1 from product_question_choice c where c.photo_asset_id = new.photo_asset_id and c.product_id <> new.product_id)) then
    raise exception 'catalogue: that file is another owner''s' using errcode = '42501';
  end if;
  update asset set seller_id = new.seller_id where id = new.photo_asset_id and seller_id is distinct from new.seller_id;
  return new;
end
$$;
create trigger product_question_choice_zphoto before insert or update of photo_asset_id on product_question_choice for each row execute function product_question_choice_photo();

-- The merchant side writes every row, a supplier its own products' (ACCESS §7.2); the shopper reads a visible product's.
grant select, insert, update, delete on product_question, product_question_choice, product_question_amount, product_question_version to app_request, app_supplier, app_system;
grant select (id, product_id, store_id, kind, label, help, required, position, min_picks, max_picks, free_picks, max_length, multiline,
  example, accept, max_files, price_mode, price_bps, price_per, shown_if_choice_id) on product_question to app_shop;
grant select (id, question_id, product_id, store_id, label, position, available, photo_asset_id, max_quantity, price_mode, price_bps, price_per)
  on product_question_choice to app_shop;
grant select (id, store_id, product_id, question_id, choice_id, version_id, currency, amount) on product_question_amount to app_shop;
grant select (question_id, version_id, product_id, store_id) on product_question_version to app_shop;

do $$
declare
  t text;
begin
  foreach t in array array['product_question', 'product_question_choice', 'product_question_amount', 'product_question_version'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for all to app_system using (true) with check (true)', t || '_system', t);
    execute format('create policy request_scope on %I as restrictive for all to app_request, app_supplier, app_shop
      using (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform'') and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))
      with check (app_setting_text(''app.scope'') in (''store'', ''shop'', ''partner'', ''platform'') and (current_user <> ''app_shop'' or app_setting_text(''app.scope'') = ''shop''))', t);
    execute format('create policy partner_scope on %I as restrictive for all to app_partner using (false) with check (false)', t);
    execute format('create policy platform_scope on %I as restrictive for all to app_platform using (false) with check (false)', t);
    execute format('create policy system_scope on %I as restrictive for all to app_system
      using (app_setting_text(''app.scope'') = ''system'') with check (app_setting_text(''app.scope'') = ''system'')', t);
    execute format('create policy support_no_insert on %I as restrictive for insert to app_request, app_supplier with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_update on %I as restrictive for update to app_request, app_supplier with check (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy support_no_delete on %I as restrictive for delete to app_request, app_supplier using (app_setting_text(''app.support'') <> ''read'')', t);
    execute format('create policy %I on %I for all to app_request, app_supplier
      using (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))
      with check (app_setting_text(''app.scope'') = ''store'' and store_id = app_setting_uuid(''app.store_id'')
        and (app_setting_text(''app.seller_id'') = '''' or seller_id = app_setting_uuid(''app.seller_id'')))', t || '_store', t);
    -- A visible product's, by the product's own shop rule (0064).
    execute format('create policy %I on %I for select to app_shop
      using (app_setting_text(''app.scope'') = ''shop'' and store_id = app_setting_uuid(''app.store_id'') and exists (select 1 from product p where p.id = product_id))', t || '_shop', t);
    -- A storefront's catalogue version and change marks move with them, as with any catalogue table (0064, 0334).
    execute format('create trigger %I after insert on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_insert', t);
    execute format('create trigger %I after update on %I referencing new table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_update', t);
    execute format('create trigger %I after delete on %I referencing old table as touched_rows for each statement execute function storefront_catalog_touched()', t || '_touch_delete', t);
    execute format('create trigger %I after insert on %I referencing new table as touched_rows for each statement execute function storefront_changed()', t || '_changed_insert', t);
    execute format('create trigger %I after update on %I referencing new table as touched_rows for each statement execute function storefront_changed()', t || '_changed_update', t);
    execute format('create trigger %I after delete on %I referencing old table as touched_rows for each statement execute function storefront_changed()', t || '_changed_delete', t);
  end loop;
end
$$;

-- A question's text and help, and a choice's name, translate as other listing text does (CATALOG fact 18).
alter table translation drop constraint translation_entity_check;
alter table translation add constraint translation_entity_check
  check (entity in ('product', 'version', 'collection', 'filter', 'filter_value', 'option_name', 'choice_name', 'question', 'question_choice'));
create or replace function translation_owner() returns trigger
language plpgsql
as $$
declare
  owner uuid;
begin
  if new.entity = 'product' then
    select p.seller_id into owner from product p where p.id = new.entity_id::uuid and p.store_id = new.store_id and p.deleted_at is null;
    if not found then raise exception 'translation: the store''s own product' using errcode = '23503'; end if;
  elsif new.entity = 'version' then
    select v.seller_id into owner from product_version v where v.id = new.entity_id::uuid and v.store_id = new.store_id and v.deleted_at is null;
    if not found then raise exception 'translation: the store''s own version' using errcode = '23503'; end if;
  elsif new.entity = 'question' then
    select q.seller_id into owner from product_question q where q.id = new.entity_id::uuid and q.store_id = new.store_id;
    if not found then raise exception 'translation: the store''s own question' using errcode = '23503'; end if;
  elsif new.entity = 'question_choice' then
    select c.seller_id into owner from product_question_choice c where c.id = new.entity_id::uuid and c.store_id = new.store_id;
    if not found then raise exception 'translation: the store''s own choice' using errcode = '23503'; end if;
  elsif new.entity = 'collection' then
    if not exists (select 1 from collection c where c.id = new.entity_id::uuid and c.store_id = new.store_id and c.deleted_at is null) then
      raise exception 'translation: the store''s own collection' using errcode = '23503';
    end if;
  elsif new.entity = 'filter' then
    if not exists (select 1 from filter f where f.id = new.entity_id::uuid and f.store_id = new.store_id) then
      raise exception 'translation: the store''s own filter' using errcode = '23503';
    end if;
  elsif new.entity = 'filter_value' then
    if not exists (select 1 from filter_value f where f.id = new.entity_id::uuid and f.store_id = new.store_id) then
      raise exception 'translation: the store''s own filter choice' using errcode = '23503';
    end if;
  end if;
  new.seller_id := owner;
  return new;
end
$$;

alter policy translation_shop on translation using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and (case entity
  when 'product' then exists (select 1 from product p where p.id::text = entity_id)
  when 'version' then exists (select 1 from product_version v where v.id::text = entity_id)
  when 'collection' then exists (select 1 from collection c where c.id::text = entity_id)
  when 'filter' then exists (select 1 from filter f where f.id::text = entity_id)
  when 'filter_value' then exists (select 1 from filter_value v where v.id::text = entity_id)
  when 'option_name' then exists (select 1 from product_option o where lower(o.name) = entity_id)
  when 'choice_name' then exists (select 1 from product_option_value v where lower(v.name) = entity_id)
  when 'question' then exists (select 1 from product_question q where q.id::text = entity_id)
  when 'question_choice' then exists (select 1 from product_question_choice c where c.id::text = entity_id)
  else false end));

-- "Include customisation extras" (OFFERS-DESIGN §3.1): off reads a customised line at its version's price alone.
alter table promotion add column include_customisation boolean not null default true;
grant insert (include_customisation), update (include_customisation) on promotion to app_request;

-- A choice's photo is shown to shoppers with its question (a visible product's, by product_question_choice's shop rule).
alter policy asset_shop on asset using (app_setting_text('app.scope') = 'shop' and store_id = app_setting_uuid('app.store_id') and (
  storefront_visible
  or exists (select 1 from product_photo x where x.asset_id = asset.id)
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
