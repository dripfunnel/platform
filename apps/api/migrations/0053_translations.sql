-- SAPI 6 (#296), part 3: translations per language, as DATA-MODEL §7.3 and CATALOG facts 18–22 and N set them out.

create table translation (
  store_id uuid not null references store (id),
  -- The translated entity's owner, set by the trigger below, never by the caller (DATA-MODEL §7.1).
  seller_id uuid,
  entity text not null check (entity in ('product', 'version', 'collection', 'filter', 'filter_value', 'option_name', 'choice_name')),
  -- The entity's id; for option and choice names, shared by text across the catalogue, the main-language name lowercased.
  entity_id text not null check (char_length(entity_id) between 1 and 255),
  field text not null check (field in ('name', 'slug', 'description')),
  language text not null,
  text text not null,
  -- md5 of the main-language text it translated, so "Changed since translated" is a comparison (N5).
  source_hash text not null check (source_hash ~ '^[0-9a-f]{32}$'),
  updated_at timestamptz not null default now(),
  primary key (store_id, entity, entity_id, field, language),
  foreign key (store_id, language) references store_language (store_id, language),
  constraint translation_field check (
    case entity
      when 'product' then field in ('name', 'slug', 'description')
      when 'collection' then field in ('name', 'slug', 'description')
      else field = 'name'
    end
  ),
  constraint translation_text check (
    case field
      when 'slug' then text ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(text) <= 120
      when 'description' then char_length(text) <= 20000
      else char_length(text) between 1 and 255
    end
  )
);

-- Web addresses are unique within each language (fact 22).
create unique index translation_slug_key on translation (store_id, entity, language, text) where field = 'slug';
create index translation_language_idx on translation (store_id, language, entity);

-- The owner is the entity's, and the entity is the store's: a supplier translates its own products only (N15),
-- and the merchant's translation of a supplier's product stays marked as that supplier's (E1).
create function translation_owner() returns trigger
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
create trigger translation_owner before insert or update on translation for each row execute function translation_owner();

grant select, insert, update, delete on translation to app_request, app_supplier;
grant select, insert, update, delete on translation to app_system;

alter table translation enable row level security;
alter table translation force row level security;
create policy translation_system on translation for all to app_system using (true) with check (true);
-- The merchant side reaches the store's translations; a supplier its own products' only.
create policy translation_store on translation for all to app_request, app_supplier
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')))
with check (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id')
  and (app_setting_text('app.seller_id') = '' or seller_id = app_setting_uuid('app.seller_id')));
create policy request_scope on translation as restrictive for all to app_request, app_supplier
using (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'))
with check (app_setting_text('app.scope') in ('store', 'shop', 'partner', 'platform'));
create policy partner_scope on translation as restrictive for all to app_partner using (false) with check (false);
create policy platform_scope on translation as restrictive for all to app_platform using (false) with check (false);
create policy system_scope on translation as restrictive for all to app_system
using (app_setting_text('app.scope') = 'system') with check (app_setting_text('app.scope') = 'system');
create policy support_no_insert on translation as restrictive for insert to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_update on translation as restrictive for update to app_request, app_supplier with check (app_setting_text('app.support') <> 'read');
create policy support_no_delete on translation as restrictive for delete to app_request, app_supplier using (app_setting_text('app.support') <> 'read');

-- A supplier reads the store's languages to translate into (N15), and the main one by a definer (no store row).
grant select on store_language to app_supplier;
alter policy store_language_merchant on store_language to app_request;
create policy store_language_supplier_read on store_language for select to app_supplier
using (app_setting_text('app.scope') = 'store' and store_id = app_setting_uuid('app.store_id'));
alter policy request_scope on store_language to app_request, app_supplier;

create function acting_store_main_language() returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.main_language from store s where app_setting_text('app.scope') = 'store' and s.id = app_setting_uuid('app.store_id')
$$;
alter function acting_store_main_language() owner to app_definer;
revoke execute on function acting_store_main_language() from public;
grant execute on function acting_store_main_language() to app_request, app_supplier;
